"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// A carteira do portal — UMA, compartilhada.
//
// Antes cada componente que precisava assinar algo chamava `window.ethereum`
// por conta própria e guardava o endereço no seu próprio `useState`: o botão de
// recolher split, o de conectar pool, o de stake, o de saque, o pipeline do MOR.
// Seis lugares, seis conexões, seis botões "Conectar" na mesma tela — e nenhum
// deles sabia que o outro já tinha conectado.
//
// Pior: nada disso sobrevivia. Trocar de aba ou dar F5 apagava tudo, porque o
// estado morava no componente. A pessoa reconectava a cada gesto.
//
// Aqui a conexão é uma só, vive acima de todos e volta sozinha ao recarregar.
//
// COMO ELA VOLTA, que é a parte que exige cuidado: `eth_accounts` (sem o
// `request`) NÃO abre popup — ele só responde o que a carteira JÁ autorizou
// para este site. Então reconectar em silêncio no load é legítimo: não estamos
// pedindo permissão de novo, estamos lendo uma permissão que já existe. Se a
// pessoa desconectou pela carteira, ele volta vazio e o portal respeita.
//
// O `localStorage` guarda só a INTENÇÃO ("esta pessoa quis conectar"), nunca a
// conta em si. Endereço vem sempre da carteira, que é a fonte da verdade — um
// endereço guardado por nós continuaria "conectado" depois de a pessoa trocar
// de conta ou revogar o acesso.

type Eth = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

function eth(): Eth | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eth }).ethereum;
}

const WANTED_KEY = "portal-wallet:wanted";

/** Redes que sabemos ensinar a uma carteira que ainda não as tem. */
const ADD_CHAIN: Record<string, Record<string, unknown>> = {
  "0x2105": {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};

type WalletValue = {
  /** Endereço conectado, em minúsculas. null = não conectado. */
  address: string | null;
  /** Há uma carteira instalada neste navegador? */
  available: boolean;
  /** Uma conexão em andamento — para o botão não ser clicado duas vezes. */
  connecting: boolean;
  /** O que deu errado na última tentativa, se deu. */
  error: string | null;
  connect: () => Promise<string | null>;
  /**
   * Garante que a carteira está na rede certa antes de assinar.
   *
   * Fica aqui e não em cada botão porque a rede é estado da CARTEIRA, não do
   * componente — mas o alvo é de quem chama: o split da SkateHive vive em oito
   * redes, e um `0x2105` fixo mandaria assinar na cadeia errada. Se a pessoa
   * recusar a troca, seguimos assim mesmo: a carteira mostra a rede na hora de
   * assinar e ela é quem decide, não nós.
   */
  ensureChain: (chainIdHex: string) => Promise<void>;
  /** Esquece a conexão do lado do portal. A carteira continua autorizada — só
   *  ela pode revogar de verdade, e o texto na tela diz isso. */
  forget: () => void;
};

const Ctx = createContext<WalletValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reconexão silenciosa + acompanhar troca de conta na carteira.
  useEffect(() => {
    const e = eth();
    setAvailable(!!e);
    if (!e) return;

    let vivo = true;
    const querConectar = (() => {
      try {
        return localStorage.getItem(WANTED_KEY) === "1";
      } catch {
        return false;
      }
    })();

    if (querConectar) {
      void e
        .request({ method: "eth_accounts" })
        .then((r) => {
          const a = Array.isArray(r) ? (r[0] as string | undefined) : undefined;
          if (vivo && a) setAddress(a.toLowerCase());
        })
        .catch(() => {});
    }

    // A carteira manda: trocou de conta lá, a tela acompanha aqui. Sem isto o
    // portal continuaria mostrando a conta antiga e assinaria com a nova.
    const onAccounts = (...args: never[]) => {
      const contas = args[0] as unknown as string[] | undefined;
      const a = Array.isArray(contas) ? contas[0] : undefined;
      setAddress(a ? a.toLowerCase() : null);
      if (!a) {
        try {
          localStorage.removeItem(WANTED_KEY);
        } catch {
          /* modo privado */
        }
      }
    };
    e.on?.("accountsChanged", onAccounts);
    return () => {
      vivo = false;
      e.removeListener?.("accountsChanged", onAccounts);
    };
  }, []);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) {
      setError("Nenhuma carteira encontrada neste navegador.");
      return null;
    }
    setConnecting(true);
    setError(null);
    try {
      const r = await e.request({ method: "eth_requestAccounts" });
      const a = Array.isArray(r) ? (r[0] as string | undefined) : undefined;
      if (!a) {
        setError("A carteira não devolveu nenhuma conta.");
        return null;
      }
      const lower = a.toLowerCase();
      setAddress(lower);
      try {
        localStorage.setItem(WANTED_KEY, "1");
      } catch {
        /* modo privado: a conexão vale para esta aba e não persiste */
      }
      return lower;
    } catch (err) {
      // Recusar o popup é uma escolha, não uma falha do sistema — a mensagem
      // não pode soar como erro nosso.
      const msg = err instanceof Error ? err.message : String(err);
      setError(/user rejected|denied/i.test(msg) ? "Conexão cancelada na carteira." : msg);
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const ensureChain = useCallback(async (chainIdHex: string) => {
    const e = eth();
    if (!e) return;
    const alvo = chainIdHex.toLowerCase();
    try {
      const atual = (await e.request({ method: "eth_chainId" })) as string;
      if (atual?.toLowerCase() === alvo) return;
      await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      // 4902 = a carteira não conhece essa rede. Dá para ensinar, mas só com os
      // parâmetros certos — então a gente só ensina as redes que declara aqui.
      // Adivinhar RPC de uma rede desconhecida seria pior que não trocar.
      const add = (err as { code?: number })?.code === 4902 ? ADD_CHAIN[alvo] : undefined;
      if (add) await e.request({ method: "wallet_addEthereumChain", params: [add] }).catch(() => {});
      // recusa: a assinatura segue e a carteira mostra a rede antes de assinar
    }
  }, []);

  const forget = useCallback(() => {
    setAddress(null);
    try {
      localStorage.removeItem(WANTED_KEY);
    } catch {
      /* modo privado */
    }
  }, []);

  const value = useMemo<WalletValue>(
    () => ({ address, available, connecting, error, connect, ensureChain, forget }),
    [address, available, connecting, error, connect, ensureChain, forget],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * A carteira compartilhada.
 *
 * Fora do provider devolve um valor inerte em vez de lançar: um botão de
 * recolher que aparece numa árvore sem provider deve ficar desabilitado, não
 * derrubar a página inteira.
 */
export function useWallet(): WalletValue {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      address: null,
      available: false,
      connecting: false,
      error: null,
      connect: async () => null,
      ensureChain: async () => {},
      forget: () => {},
    }
  );
}
