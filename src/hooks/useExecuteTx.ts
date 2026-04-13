"use client";

import { useState, useRef, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { TxStatus } from "@/components/chat/cards/types";

interface UseExecuteTxParams {
  buildTx: () => Promise<string>;
  onSuccess?: (sig: string) => void;
}

interface UseExecuteTxReturn {
  status: TxStatus;
  txSig: string;
  error: string;
  execute: () => Promise<void>;
  reset: () => void;
}

export function useExecuteTx({ buildTx, onSuccess }: UseExecuteTxParams): UseExecuteTxReturn {
  const { signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState<TxStatus>("preview");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const executing = useRef(false);

  const execute = useCallback(async () => {
    if (executing.current) return;
    if (status !== "preview" || !connected || !signTransaction) return;

    executing.current = true;
    setStatus("executing");
    setError("");

    try {
      // Step 1: Build tx (card-specific — caller handles API call + clean-tx)
      const txBase64 = await buildTx();

      // Step 2: Deserialize
      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      // Step 3: Sign
      setStatus("signing");
      const signed = await signTransaction(transaction);

      // Step 4: Broadcast + confirm
      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      setStatus("success");
      onSuccess?.(signature);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    } finally {
      executing.current = false;
    }
  }, [buildTx, connected, connection, onSuccess, signTransaction, status]);

  const reset = useCallback(() => {
    setStatus("preview");
    setTxSig("");
    setError("");
    executing.current = false;
  }, []);

  return { status, txSig, error, execute, reset };
}
