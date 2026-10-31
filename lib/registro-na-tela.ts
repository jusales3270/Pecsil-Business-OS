"use client";

import { useEffect, useRef } from "react";
import { ouvirRegistro, tomarRegistro, type PedidoRegistro } from "./abrir-registro";

/** Por quanto tempo a tela espera a linha aparecer (os dados podem ainda estar carregando). */
const ESPERA_MS = 6_000;
const ACESO_MS = 4_000;

/** Rola até `[data-registro="id"]` e acende por 4 s, sem abrir nada. Espera a linha aparecer. */
export function destacarNaTela(id: string) {
  const inicio = Date.now();
  const tentar = () => {
    // A mesma linha pode existir na tabela e na versão de celular: vale a que está visível.
    const el = [...document.querySelectorAll<HTMLElement>(`[data-registro="${CSS.escape(id)}"]`)].find((x) => x.offsetParent !== null);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      el.classList.add("sara-destaque");
      setTimeout(() => el.classList.remove("sara-destaque"), ACESO_MS);
    } else if (Date.now() - inicio < ESPERA_MS) setTimeout(tentar, 250);
  };
  tentar();
}

/** A tela atende o pedido da SARA ao montar e, já aberta, na hora em que ele chega. */
export function useRegistroNaTela<T extends PedidoRegistro["tipo"]>(tipo: T, atender: (p: Extract<PedidoRegistro, { tipo: T }>) => void) {
  const fn = useRef(atender);
  useEffect(() => { fn.current = atender; });
  useEffect(() => {
    const aplicar = () => {
      const p = tomarRegistro((x) => x.tipo === tipo);
      if (p) fn.current(p as Extract<PedidoRegistro, { tipo: T }>);
    };
    const t = setTimeout(aplicar, 0);
    const parar = ouvirRegistro(aplicar);
    return () => { clearTimeout(t); parar(); };
  }, [tipo]);
}
