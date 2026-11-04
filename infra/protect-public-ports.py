#!/usr/bin/env python3
"""Regras aditivas de perímetro; plano por padrão. Nunca executar no Mac/produção sem revisão."""
import argparse
import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid

PORTS = (5432, 6543, 8000, 8001, 8443, 3000, 3100, 3200)
STATE_DIR = Path("/var/lib/pecsil-firewall")
UNIT = "pecsil-public-ports.service"
UNIT_PATH = Path("/etc/systemd/system") / UNIT
PYTHON = "/usr/bin/python3"


class Unsafe(RuntimeError):
    pass


def config(interface, allowed, admin=None, console=False):
    if not interface or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", interface) or interface == "lo" or interface.startswith(("docker", "br-", "veth")):
        raise Unsafe("Informe a interface física de entrada; loopback, coringas e bridges Docker são recusados.")
    if not allowed:
        raise Unsafe("Informe explicitamente pelo menos um CIDR permitido da LAN/VPN.")

    def cidr(value):
        try:
            network = ipaddress.ip_network(value, strict=True)
        except ValueError as exc:
            raise Unsafe("CIDR inválido ou endereço não alinhado à rede: " + value) from exc
        if network.prefixlen < (8 if network.version == 4 else 16) or network.is_loopback or network.is_multicast or network.network_address.is_unspecified:
            raise Unsafe("CIDR excessivamente amplo, loopback ou inválido: " + value)
        return str(network)

    networks = sorted(set(cidr(value) for value in allowed))
    if len(networks) > 32:
        raise Unsafe("Limite de 32 redes permitidas; revise o escopo.")
    if bool(admin) != bool(console):
        raise Unsafe("Restringir SSH exige --admin-cidr e --console-verified juntos; sem ambos a porta 22 fica inalterada.")
    administrative = cidr(admin) if admin else None
    if administrative and ipaddress.ip_network(administrative).prefixlen < (24 if "." in administrative else 64):
        raise Unsafe("O CIDR administrativo precisa ser específico (/24 IPv4 ou /64 IPv6, ou mais restrito).")
    return {"interface": interface, "allowed": networks, "admin": administrative, "console": console}


def validate_stored(value):
    if not isinstance(value, dict) or set(value) != {"interface", "allowed", "admin", "console"} or not isinstance(value["allowed"], list) or not isinstance(value["console"], bool):
        raise Unsafe("Configuração persistida inválida.")
    return config(value["interface"], value["allowed"], value["admin"], value["console"])


def identifier(value):
    if not re.fullmatch(r"[0-9a-f]{12}", value):
        raise Unsafe("Identificador de alteração inválido.")
    return value


def operations(cfg, change):
    """Cada operação leva sua inversa; não modifica policy nem regras preexistentes."""
    identifier(change)
    result = []
    for binary, version in (("iptables", 4), ("ip6tables", 6)):
        host, docker = "PBOI_" + change, "PBOD_" + change
        for chain in (host, docker):
            result.append(([binary, "-N", chain], [binary, "-X", chain]))
        networks = [n for n in cfg["allowed"] if ipaddress.ip_network(n).version == version]
        for chain in (host, docker):
            for network in networks:
                rule = [chain, "-s", network, "-j", "RETURN"]
                result.append(([binary, "-A"] + rule, [binary, "-D"] + rule))
        rule = [host, "-p", "tcp", "-m", "multiport", "--dports", ",".join(map(str, PORTS)), "-j", "DROP"]
        result.append(([binary, "-A"] + rule, [binary, "-D"] + rule))
        for port in PORTS:
            # No DOCKER-USER o pacote já sofreu DNAT; a porta atual pode ser outra.
            rule = [docker, "-p", "tcp", "-m", "conntrack", "--ctdir", "ORIGINAL", "--ctorigdstport", str(port), "-j", "DROP"]
            result.append(([binary, "-A"] + rule, [binary, "-D"] + rule))
        if cfg["admin"]:
            admin = cfg["admin"] if ipaddress.ip_network(cfg["admin"]).version == version else None
            # SSH não usa o allowlist LAN geral: só o CIDR administrativo explicitamente escolhido.
            ssh = "PBOS_" + change
            result.append(([binary, "-N", ssh], [binary, "-X", ssh]))
            if admin:
                rule = [ssh, "-s", admin, "-j", "RETURN"]
                result.append(([binary, "-A"] + rule, [binary, "-D"] + rule))
            rule = [ssh, "-j", "DROP"]
            result.append(([binary, "-A"] + rule, [binary, "-D"] + rule))
            rule = ["INPUT", "-i", cfg["interface"], "-p", "tcp", "--dport", "22", "-j", ssh]
            result.append(([binary, "-I", "INPUT", "1"] + rule[1:], [binary, "-D"] + rule))
        # Os saltos entram SOMENTE depois de as cadeias estarem completas.
        for parent, child in (("INPUT", host), ("DOCKER-USER", docker)):
            rule = [parent, "-i", cfg["interface"], "-j", child]
            result.append(([binary, "-I", parent, "1"] + rule[1:], [binary, "-D"] + rule))
    return result


def run(args, *, check=True, timeout=15):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unsafe("Comando administrativo indisponível ou excedeu prazo: " + args[0]) from exc
    if check and result.returncode:
        # Não despeja stderr/ambiente nem configurações potencialmente sensíveis.
        raise Unsafe("Comando administrativo recusado: " + " ".join(args[:3]))
    return result


def checked_binary(name):
    found = shutil.which(name)
    if not found:
        raise Unsafe("Ferramenta necessária ausente: " + name)
    path = Path(found).resolve()
    if str(path.parent) not in ("/usr/bin", "/bin", "/usr/sbin", "/sbin"):
        raise Unsafe("Ferramenta fora dos diretórios do sistema: " + name)
    info = path.stat()
    if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise Unsafe("Ferramenta administrativa não está protegida: " + name)
    # Preserva o nome do symlink (iptables/ip6tables são applets de xtables-nft-multi).
    return str(Path(found).absolute())


def recovery_binaries():
    if platform.system() != "Linux" or os.geteuid() != 0:
        raise Unsafe("Operação somente no host Linux como root.")
    binaries = {name: checked_binary(name) for name in ("iptables", "ip6tables", "systemctl")}
    for name in ("iptables", "ip6tables"):
        if "nf_tables" not in run([binaries[name], "--version"]).stdout:
            raise Unsafe("Backend mudou; recuperação requer revisar as regras iptables-nft pelo console.")
    return binaries


def preflight(cfg):
    if platform.system() != "Linux" or os.geteuid() != 0:
        raise Unsafe("Aplicação somente em host Linux com root; esta estação não deve alterar firewall.")
    if cfg["interface"] not in {name for _, name in socket.if_nameindex()}:
        raise Unsafe("Interface não existe neste host.")
    if not Path("/run/systemd/system").is_dir():
        raise Unsafe("systemd não está ativo; rollback temporizado não pode ser garantido.")
    binaries = {name: checked_binary(name) for name in ("iptables", "ip6tables", "iptables-save", "ip6tables-save", "nft", "systemctl", "systemd-run")}
    for name in ("iptables", "ip6tables"):
        if "nf_tables" not in run([binaries[name], "--version"]).stdout:
            raise Unsafe("Suportado somente iptables-nft consistente em IPv4/IPv6; backend legacy recusado.")
        run([binaries[name], "-w", "5", "-t", "filter", "-S", "DOCKER-USER"])
        forward = run([binaries[name], "-w", "5", "-t", "filter", "-S", "FORWARD"]).stdout
        if not re.search(r"^-A FORWARD -j DOCKER-USER$", forward, re.M):
            raise Unsafe("DOCKER-USER não está no caminho de FORWARD; recusa cobertura parcial de Docker.")
    if "docker-bridges" in run([binaries["nft"], "list", "tables"]).stdout:
        raise Unsafe("Backend nativo nftables do Docker detectado; este procedimento requer iptables-nft/DOCKER-USER.")
    for name in ("iptables-legacy-save", "ip6tables-legacy-save"):
        if shutil.which(name):
            old = run([checked_binary(name)], check=False)
            if old.returncode == 0 and (re.search(r"^-(A|N) ", old.stdout, re.M) or re.search(r"^:\S+ (DROP|REJECT) ", old.stdout, re.M)):
                raise Unsafe("Regras legacy paralelas detectadas; revisar backend antes de prosseguir.")
    if run([binaries["systemctl"], "is-active", "firewalld"], check=False).returncode == 0:
        raise Unsafe("firewalld ativo: a coordenação de reloads precisa ser feita antes deste procedimento.")
    return binaries


def execute_rule(command, binaries, *, check=True):
    return run([binaries[command[0]], "-w", "5", "-t", "filter"] + command[1:], check=check)


def secure_directory():
    if STATE_DIR.is_symlink():
        raise Unsafe("Diretório de estado não pode ser symlink.")
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = STATE_DIR.stat()
    if info.st_uid != 0 or info.st_mode & 0o077:
        raise Unsafe("Diretório de estado precisa pertencer a root e ter modo 0700.")


def write_state(state):
    target = STATE_DIR / (identifier(state["id"]) + ".json")
    temporary = target.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(state, out, indent=2)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(target)


def read_state(change):
    path = STATE_DIR / (identifier(change) + ".json")
    if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise Unsafe("Arquivo de estado sem proteção de root.")
    state = json.loads(path.read_text())
    if state.get("id") != change:
        raise Unsafe("Identificador e estado divergem.")
    state["config"] = validate_stored(state["config"])
    return state


def timer_name(change):
    return "pecsil-ports-rollback-" + identifier(change)


def arm_rollback(state, binaries, seconds):
    runner = str(STATE_DIR / "runner.py")
    run([binaries["systemd-run"], "--unit=" + timer_name(state["id"]), "--on-active=" + str(seconds) + "s", "--timer-property=AccuracySec=1s", "--property=Type=oneshot", PYTHON, runner, "--rollback", "--automatic", "--state-id", state["id"]])
    run([binaries["systemctl"], "is-active", "--quiet", timer_name(state["id"]) + ".timer"])


def install_operations(state, binaries, seconds, arm=arm_rollback, execute=execute_rule):
    # Testável sem firewall. Se o agendamento falhar, nenhuma operação é executada.
    arm(state, binaries, seconds)
    deadline = time.monotonic() + seconds / 2
    for command, _ in operations(state["config"], state["id"]):
        if time.monotonic() >= deadline:
            raise Unsafe("Prazo da aplicação excedido; reversão necessária.")
        execute(command, binaries)


def rollback(state, binaries):
    failures = []
    for _, inverse in reversed(operations(state["config"], state["id"])):
        if inverse[1] == "-D":
            exists = [inverse[0], "-C"] + inverse[2:]
            if execute_rule(exists, binaries, check=False).returncode != 0:
                continue
        elif inverse[1] == "-X":
            if execute_rule([inverse[0], "-S", inverse[2]], binaries, check=False).returncode != 0:
                continue
        if execute_rule(inverse, binaries, check=False).returncode != 0:
            failures.append(inverse[:3])
    if failures:
        raise Unsafe("Reversão incompleta: mantenha console aberto e revise as cadeias PBO desta alteração.")
    state["status"] = "rolled-back"
    write_state(state)


def persistence(state, binaries):
    # Nenhuma fotografia global de regras Docker é restaurada no boot.
    contents = "\n".join([
        "[Unit]", "Description=Pecsil confirmed public-port guard", "After=network-online.target docker.service", "Wants=network-online.target", "Requires=docker.service", "PartOf=docker.service", "", "[Service]", "Type=oneshot", "RemainAfterExit=yes", "ExecStart=" + PYTHON + " " + str(STATE_DIR / "runner.py") + " --restore-confirmed --state-id " + state["id"], "", "[Install]", "WantedBy=multi-user.target", "",
    ])
    if UNIT_PATH.exists() or UNIT_PATH.is_symlink():
        raise Unsafe("Serviço persistente já existe; não será sobrescrito.")
    fd = os.open(UNIT_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "w") as out:
        out.write(contents)
    try:
        run([binaries["systemctl"], "daemon-reload"])
        run([binaries["systemctl"], "enable", UNIT])
    except Exception:
        UNIT_PATH.unlink()
        run([binaries["systemctl"], "daemon-reload"], check=False)
        raise


def restore_confirmed(state, binaries):
    if state["status"] != "confirmed" or not state.get("persistent"):
        raise Unsafe("Somente uma configuração já confirmada e persistente pode ser reaplicada no boot.")
    for command, _ in operations(state["config"], state["id"]):
        if command[1] == "-N":
            if execute_rule([command[0], "-S", command[2]], binaries, check=False).returncode == 0:
                continue
        else:
            check = [command[0], "-C"] + (command[2:3] + command[4:] if command[1] == "-I" else command[2:])
            if execute_rule(check, binaries, check=False).returncode == 0:
                continue
        execute_rule(command, binaries)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true", help="Padrão: apenas imprime comandos, sem ler/alterar firewall")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--confirm", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    mode.add_argument("--restore-confirmed", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--interface")
    parser.add_argument("--allow-cidr", action="append", default=[])
    parser.add_argument("--admin-cidr")
    parser.add_argument("--console-verified", action="store_true")
    parser.add_argument("--recovery-verified", action="store_true", help="Operador confirmou console/recovery independente da sessão")
    parser.add_argument("--checks-passed", action="store_true", help="Operador conferiu acesso externo, app, LAN, Docker e nova sessão administrativa")
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--automatic", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--rollback-seconds", type=int, default=180)
    parser.add_argument("--state-id")
    args = parser.parse_args(argv)
    if args.apply or not (args.confirm or args.rollback or args.restore_confirmed):
        cfg = config(args.interface, args.allow_cidr, args.admin_cidr, args.console_verified)
    else:
        if args.interface or args.allow_cidr or args.admin_cidr or args.console_verified:
            raise Unsafe("Confirmar/reverter usa a configuração já gravada; não aceita nova interface/CIDR.")
        if not args.state_id:
            raise Unsafe("Informe --state-id mostrado na aplicação.")
        cfg = None
    if args.persist and not args.confirm:
        raise Unsafe("--persist só pode ser usado com --confirm.")
    if not (args.apply or args.confirm or args.rollback or args.restore_confirmed):
        print("SIMULAÇÃO: nenhum comando será executado. HTTP 80/HTTPS 443 e SSH 22 permanecem inalterados salvo --admin-cidr.")
        print("IPv4+IPv6: permite RETURN dos CIDRs listados; bloqueia apenas portas sensíveis na interface escolhida.")
        for command, _ in operations(cfg, "000000000000"):
            print(shlex.join([command[0], "-w", "5", "-t", "filter"] + command[1:]))
        return 0
    if args.automatic and not args.rollback:
        raise Unsafe("--automatic só pode ser usado pelo rollback temporizado.")
    if args.apply and (not args.recovery_verified or not 120 <= args.rollback_seconds <= 900):
        raise Unsafe("Aplicar exige --recovery-verified e rollback de 120 a 900 segundos.")
    if args.confirm and not args.checks_passed:
        raise Unsafe("Confirmar exige --checks-passed após conferir os fluxos externos/internos.")
    if platform.system() != "Linux" or os.geteuid() != 0:
        raise Unsafe("Operação somente no host Linux como root; nenhuma regra foi alterada.")
    secure_directory()
    lock_path = STATE_DIR / "lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.apply:
            binaries = preflight(cfg)
            if list(STATE_DIR.glob("*.json")):
                existing = [read_state(p.stem) for p in STATE_DIR.glob("*.json")]
                if any(s["status"] != "rolled-back" for s in existing):
                    raise Unsafe("Há uma alteração pendente/confirmada; confirme ou reverta antes de criar outra.")
            change = uuid.uuid4().hex[:12]
            state = {"id": change, "config": cfg, "status": "pending", "persistent": False, "created": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            runner = STATE_DIR / "runner.py"
            if runner.is_symlink():
                raise Unsafe("Runner de recuperação não pode ser symlink.")
            shutil.copyfile(Path(__file__).resolve(), runner)
            runner.chmod(0o700)
            write_state(state)
            for binary in ("iptables-save", "ip6tables-save"):
                snapshot = STATE_DIR / (change + "." + binary)
                snap_fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(snap_fd, "w") as out:
                    out.write(run([binaries[binary]]).stdout)
            try:
                install_operations(state, binaries, args.rollback_seconds)
            except Exception:
                rollback(state, binaries)
                raise
            print("Aplicação temporária concluída. Identificador: " + change)
            print("Reversão automática em até " + str(args.rollback_seconds) + "s; NÃO confirme antes dos testes externos e internos.")
            return 0
        state = read_state(args.state_id)
        if state["status"] == "rolled-back" or args.automatic and state["status"] != "pending":
            return 0  # Timer já disparado, mas a confirmação/reversão ganhou o lock primeiro.
        binaries = recovery_binaries() if args.rollback else preflight(state["config"])
        if args.rollback:
            if state.get("persistent"):
                # Confere a unidade antes de desabilitar; nunca toca unidade de outro dono.
                if not UNIT_PATH.is_file() or ("--state-id " + state["id"]) not in UNIT_PATH.read_text():
                    raise Unsafe("Unidade persistente diverge do estado; revisar manualmente pelo console.")
                run([binaries["systemctl"], "disable", "--now", UNIT])
                UNIT_PATH.unlink()
                run([binaries["systemctl"], "daemon-reload"])
            rollback(state, binaries)
            run([binaries["systemctl"], "stop", timer_name(state["id"]) + ".timer"], check=False)
            print("Reversão concluída; somente as regras próprias foram removidas.")
        elif args.confirm:
            if state["status"] != "pending":
                raise Unsafe("Alteração não está pendente; nenhuma confirmação aplicada.")
            run([binaries["systemctl"], "is-active", "--quiet", timer_name(state["id"]) + ".timer"])
            if args.persist:
                persistence(state, binaries)
                state["persistent"] = True
            state["status"] = "confirmed"
            write_state(state)
            run([binaries["systemctl"], "stop", timer_name(state["id"]) + ".timer"])
            if state["persistent"]:
                # Não espera o runner enquanto seguramos o lock que ele próprio adquire.
                run([binaries["systemctl"], "--no-block", "start", UNIT])
            print("Confirmado" + (" e persistente após Docker/reboot." if state["persistent"] else "; válido até limpeza/reboot do firewall. Persistência não foi instalada."))
        else:
            restore_confirmed(state, binaries)
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Unsafe, OSError, ValueError, KeyError, TypeError) as error:
        print("RECUSADO: " + str(error), file=sys.stderr)
        sys.exit(1)
