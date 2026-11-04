"""Contratos de firewall com executor falso. NUNCA executa iptables/systemctl reais."""
import contextlib
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("guard", Path(__file__).resolve().parents[2] / "infra/protect-public-ports.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
CFG = guard.config("ens18", ["192.168.0.0/24", "fd12:3456:789a::/64"])
ID = "123456abcdef"


class FirewallSafety(unittest.TestCase):
    def test_plan_is_inert_dual_stack_and_port_specific(self):
        output = io.StringIO()
        with patch.object(guard, "run", side_effect=AssertionError("plano não pode executar ferramentas")), contextlib.redirect_stdout(output):
            self.assertEqual(guard.main(["--interface", "ens18", "--allow-cidr", "192.168.0.0/24"]), 0)
        commands = [command for command, _ in guard.operations(CFG, ID)]
        self.assertEqual({c[0] for c in commands}, {"iptables", "ip6tables"})
        expected_ports = {5432, 6543, 6001, 6002, 8000, 8001, 8080, 8443, 3000, 3100, 3200}
        for binary, network in (("iptables", "192.168.0.0/24"), ("ip6tables", "fd12:3456:789a::/64")):
            rules = [c for c in commands if c[0] == binary]
            input_drops = [c for c in rules if "--dports" in c]
            self.assertEqual(len(input_drops), 1)
            self.assertEqual(set(map(int, input_drops[0][input_drops[0].index("--dports") + 1].split(","))), expected_ports)
            docker_drops = [c for c in rules if "--ctorigdstport" in c]
            self.assertEqual({int(c[c.index("--ctorigdstport") + 1]) for c in docker_drops}, expected_ports)
            self.assertEqual(len(docker_drops), len(expected_ports))
            for c in docker_drops:
                self.assertEqual(c[c.index("--ctdir") + 1], "ORIGINAL")
            # A mesma exceção LAN/VPN antecede todo bloqueio, nas duas cadeias.
            for chain in ("PBOI_" + ID, "PBOD_" + ID):
                scoped = [c for c in rules if c[1:3] == ["-A", chain]]
                self.assertEqual(scoped[0], [binary, "-A", chain, "-s", network, "-j", "RETURN"])
                self.assertTrue(all(c[-1] == "DROP" for c in scoped[1:]))
        self.assertTrue(any(c[1:3] == ["-I", "INPUT"] for c in commands))
        self.assertTrue(any(c[1:3] == ["-I", "DOCKER-USER"] for c in commands))
        for c in commands:
            self.assertFalse(set(c) & {"-F", "--flush", "-P", "80", "443", "22", "ACCEPT"})
            if c[1] == "-I":
                self.assertEqual(c[4:6], ["-i", "ens18"])
        self.assertIn("SIMULAÇÃO", output.getvalue())

    def test_interface_and_network_validation(self):
        for interface in (None, "lo", "ens18+", "ens18;whoami", "br-deadbeef", "docker0", "veth01", "x" * 16):
            with self.subTest(interface=interface), self.assertRaises(guard.Unsafe):
                guard.config(interface, ["192.168.0.0/24"])
        for cidr in ("0.0.0.0/0", "::/0", "192.168.0.1/24", "127.0.0.0/8", "224.0.0.0/4", "not-a-network"):
            with self.subTest(cidr=cidr), self.assertRaises(guard.Unsafe):
                guard.config("ens18", [cidr])
        with self.assertRaises(guard.Unsafe):
            guard.config("ens18", [])
        with self.assertRaises(guard.Unsafe):
            guard.identifier("123;bad")

    def test_ssh_is_untouched_unless_admin_cidr_and_verified_console(self):
        with self.assertRaises(guard.Unsafe):
            guard.config("ens18", CFG["allowed"], "198.51.100.7/32")
        with self.assertRaises(guard.Unsafe):
            guard.config("ens18", CFG["allowed"], console=True)
        with self.assertRaises(guard.Unsafe):
            guard.config("ens18", CFG["allowed"], "10.0.0.0/8", console=True)
        cfg = guard.config("ens18", CFG["allowed"], "198.51.100.7/32", console=True)
        rules = [c for c, _ in guard.operations(cfg, ID)]
        ssh = [c for c in rules if "PBOS_" + ID in c]
        self.assertTrue(any("198.51.100.7/32" in c and "RETURN" in c for c in ssh))
        self.assertFalse(any("192.168.0.0/24" in c for c in ssh))
        self.assertEqual(sum("22" in c and c[1] == "-I" for c in ssh), 2)

    def test_rollback_is_armed_before_first_mutation(self):
        state = {"id": ID, "config": CFG}
        events = []
        guard.install_operations(state, {}, 180,
                                 arm=lambda *_: events.append("timer-confirmed"),
                                 execute=lambda command, _: events.append(command))
        self.assertEqual(events[0], "timer-confirmed")
        self.assertGreater(len(events), 20)
        events.clear()
        def unavailable(*_):
            events.append("timer-failed")
            raise guard.Unsafe("scheduler unavailable")
        with self.assertRaises(guard.Unsafe):
            guard.install_operations(state, {}, 180, arm=unavailable, execute=lambda *args: events.append(args))
        self.assertEqual(events, ["timer-failed"])

    def test_timer_checks_active_before_returning(self):
        recorded = []
        def execute(args, **_):
            recorded.append(args)
            return SimpleNamespace(returncode=0, stdout="")
        with patch.object(guard, "run", side_effect=execute):
            guard.arm_rollback({"id": ID}, {"systemd-run": "systemd-run", "systemctl": "systemctl"}, 180)
        self.assertEqual(recorded[0][0], "systemd-run")
        self.assertIn("--on-active=180s", recorded[0])
        self.assertIn("--automatic", recorded[0])
        self.assertEqual(recorded[1], ["systemctl", "is-active", "--quiet", "pecsil-ports-rollback-" + ID + ".timer"])

    def test_rollback_removes_only_own_rules_without_flush(self):
        state = {"id": ID, "config": CFG, "status": "pending"}
        commands = []
        def execute(command, _, **kwargs):
            commands.append(command)
            return SimpleNamespace(returncode=0)
        with patch.object(guard, "execute_rule", side_effect=execute), patch.object(guard, "write_state"):
            guard.rollback(state, {})
        mutations = [c for c in commands if c[1] in ("-D", "-X")]
        self.assertTrue(mutations)
        for command in mutations:
            self.assertTrue(any("PBO" in value and ID in value for value in command))
            self.assertFalse(set(command) & {"-F", "--flush", "-P"})
        self.assertEqual(state["status"], "rolled-back")
        self.assertEqual(mutations[0][1:3], ["-D", "DOCKER-USER"])

    def fake_preflight(self, *, legacy=False, missing_ipv6=False, firewalld=False, native=False):
        def execute(command, **kwargs):
            binary = Path(command[0]).name
            if "--version" in command:
                return SimpleNamespace(returncode=0, stdout="iptables v1.8.9 (legacy)" if legacy else "iptables v1.8.9 (nf_tables)")
            if command[-1] == "DOCKER-USER":
                if missing_ipv6 and binary == "ip6tables":
                    raise guard.Unsafe("missing IPv6 chain")
                return SimpleNamespace(returncode=0, stdout="-N DOCKER-USER\n")
            if command[-1] == "FORWARD":
                return SimpleNamespace(returncode=0, stdout="-A FORWARD -j DOCKER-USER\n")
            if binary == "nft":
                return SimpleNamespace(returncode=0, stdout="table ip docker-bridges" if native else "")
            if binary == "systemctl":
                return SimpleNamespace(returncode=0 if firewalld else 3, stdout="")
            raise AssertionError(command)
        return execute

    def test_unsupported_backends_and_partial_ipv6_refused(self):
        for scenario in ({}, {"legacy": True}, {"missing_ipv6": True}, {"firewalld": True}, {"native": True}):
            with self.subTest(scenario=scenario), patch.object(guard.platform, "system", return_value="Linux"), patch.object(guard.os, "geteuid", return_value=0), patch.object(guard.socket, "if_nameindex", return_value=[(1, "ens18")]), patch.object(guard.Path, "is_dir", return_value=True), patch.object(guard, "checked_binary", side_effect=lambda name: "/usr/sbin/" + name), patch.object(guard.shutil, "which", return_value=None), patch.object(guard, "run", side_effect=self.fake_preflight(**scenario)):
                if scenario:
                    with self.assertRaises(guard.Unsafe):
                        guard.preflight(CFG)
                else:
                    self.assertIn("ip6tables", guard.preflight(CFG))

    def test_missing_recovery_refused_without_tool_or_fs_calls(self):
        with patch.object(guard, "run", side_effect=AssertionError("não deveria executar")), patch.object(guard, "secure_directory", side_effect=AssertionError("não deveria gravar")):
            with self.assertRaisesRegex(guard.Unsafe, "recovery"):
                guard.main(["--apply", "--interface", "ens18", "--allow-cidr", "192.168.0.0/24"])

    def test_boot_replay_requires_confirmation_and_is_idempotent(self):
        with self.assertRaises(guard.Unsafe):
            guard.restore_confirmed({"id": ID, "config": CFG, "status": "pending", "persistent": True}, {})
        calls = []
        with patch.object(guard, "execute_rule", side_effect=lambda command, *a, **kw: (calls.append(command), SimpleNamespace(returncode=0))[1]):
            guard.restore_confirmed({"id": ID, "config": CFG, "status": "confirmed", "persistent": True}, {})
        self.assertTrue(calls)
        self.assertTrue(all(c[1] in ("-C", "-S") for c in calls))

    def test_confirmed_state_wins_race_with_timer_without_touching_firewall(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(guard, "STATE_DIR", Path(temporary)), patch.object(guard.platform, "system", return_value="Linux"), patch.object(guard.os, "geteuid", return_value=0), patch.object(guard, "secure_directory"), patch.object(guard, "read_state", return_value={"status": "confirmed"}), patch.object(guard, "recovery_binaries", side_effect=AssertionError("não deveria tocar firewall")):
            self.assertEqual(guard.main(["--rollback", "--automatic", "--state-id", ID]), 0)

    def test_persistence_never_overwrites_existing_unit(self):
        with tempfile.TemporaryDirectory() as temporary:
            existing = Path(temporary) / "unit.service"
            existing.write_text("existing-owner")
            with patch.object(guard, "UNIT_PATH", existing), patch.object(guard, "run", side_effect=AssertionError("não deve executar")), self.assertRaises(guard.Unsafe):
                guard.persistence({"id": ID}, {})
            self.assertEqual(existing.read_text(), "existing-owner")


if __name__ == "__main__":
    unittest.main(verbosity=2)
