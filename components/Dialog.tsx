"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Return an error string if invalid, or null if valid. */
  validate?: (value: string) => string | null;
}

export interface AdminPasswordResult {
  currentPassword: string;
  newPassword: string;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: { title: string; message: string }) => Promise<void>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  adminPassword: () => Promise<AdminPasswordResult | null>;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const DialogContext = createContext<DialogContextValue | null>(null);

type ModalState =
  | { type: "none" }
  | { type: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: "alert"; title: string; message: string; resolve: () => void }
  | {
      type: "prompt";
      opts: PromptOptions;
      resolve: (v: string | null) => void;
    }
  | {
      type: "adminPassword";
      resolve: (v: AdminPasswordResult | null) => void;
    };

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState>({ type: "none" });

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setModal({ type: "confirm", opts, resolve }),
      ),
    [],
  );

  const alert = useCallback(
    (opts: { title: string; message: string }) =>
      new Promise<void>((resolve) =>
        setModal({
          type: "alert",
          title: opts.title,
          message: opts.message,
          resolve,
        }),
      ),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        setModal({ type: "prompt", opts, resolve }),
      ),
    [],
  );

  const adminPassword = useCallback(
    () =>
      new Promise<AdminPasswordResult | null>((resolve) =>
        setModal({ type: "adminPassword", resolve }),
      ),
    [],
  );

  const close = useCallback(() => setModal({ type: "none" }), []);

  const value: DialogContextValue = { confirm, alert, prompt, adminPassword };

  return (
    <DialogContext.Provider value={value}>
      {children}
      {modal.type !== "none" && (
        <Backdrop onClose={close}>
          {modal.type === "confirm" && (
            <ConfirmDialogBody
              opts={modal.opts}
              onResolve={(v) => {
                modal.resolve(v);
                close();
              }}
            />
          )}
          {modal.type === "alert" && (
            <AlertDialogBody
              title={modal.title}
              message={modal.message}
              onDone={() => {
                modal.resolve();
                close();
              }}
            />
          )}
          {modal.type === "prompt" && (
            <PromptDialogBody
              opts={modal.opts}
              onResolve={(v) => {
                modal.resolve(v);
                close();
              }}
            />
          )}
          {modal.type === "adminPassword" && (
            <AdminPasswordDialogBody
              onResolve={(v) => {
                modal.resolve(v);
                close();
              }}
            />
          )}
        </Backdrop>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx)
    throw new Error("useDialog must be used inside DialogProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Backdrop                                                           */
/* ------------------------------------------------------------------ */

function Backdrop({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      {/* Stop propagation so clicking inside the dialog doesn't close it */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md animate-dialog-in"
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm Dialog                                                     */
/* ------------------------------------------------------------------ */

function ConfirmDialogBody({
  opts,
  onResolve,
}: {
  opts: ConfirmOptions;
  onResolve: (v: boolean) => void;
}) {
  return (
    <div className="mx-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 sm:mx-0">
      <h2 className="text-lg font-bold text-slate-900">{opts.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
        {opts.message}
      </p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          className="btn-secondary flex-1"
          onClick={() => onResolve(false)}
        >
          {opts.cancelLabel ?? "取消"}
        </button>
        <button
          type="button"
          className={opts.danger ? "btn-danger flex-1" : "btn-primary flex-1"}
          onClick={() => onResolve(true)}
        >
          {opts.confirmLabel ?? "确认"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Alert Dialog                                                       */
/* ------------------------------------------------------------------ */

function AlertDialogBody({
  title,
  message,
  onDone,
}: {
  title: string;
  message: string;
  onDone: () => void;
}) {
  return (
    <div className="mx-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 sm:mx-0">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
        {message}
      </p>
      <div className="mt-5">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={onDone}
        >
          知道了
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Prompt Dialog                                                      */
/* ------------------------------------------------------------------ */

function PromptDialogBody({
  opts,
  onResolve,
}: {
  opts: PromptOptions;
  onResolve: (v: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (opts.validate) {
      const msg = opts.validate(trimmed);
      if (msg) {
        setError(msg);
        return;
      }
    }
    onResolve(trimmed);
  }

  return (
    <form
      onSubmit={submit}
      className="mx-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 sm:mx-0"
    >
      <h2 className="text-lg font-bold text-slate-900">{opts.title}</h2>
      {opts.message && (
        <p className="mt-1 text-sm text-slate-500">{opts.message}</p>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        placeholder={opts.placeholder}
        className="field mt-3"
        autoFocus
      />
      {error && (
        <p className="mt-1.5 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="btn-secondary flex-1"
          onClick={() => onResolve(null)}
        >
          取消
        </button>
        <button type="submit" className="btn-primary flex-1">
          {opts.confirmLabel ?? "确认"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Password Dialog                                              */
/* ------------------------------------------------------------------ */

function AdminPasswordDialogBody({
  onResolve,
}: {
  onResolve: (v: AdminPasswordResult | null) => void;
}) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Track per-field validation after first submit attempt
  const [touched, setTouched] = useState(false);
  const currentErr = touched && !current.trim() ? "请输入当前密码" : null;
  const newErr =
    touched && (!newPw || newPw.length < 6)
      ? "新密码至少 6 位"
      : null;
  const confirmErr =
    touched && newPw !== confirm ? "两次输入的密码不一致" : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (currentErr || newErr || confirmErr) return;
    setBusy(true);
    setError(null);
    // The actual API call is done by the caller via onResolve;
    // the DialogProvider closes immediately. The calling code
    // (`handleChangeAdminPassword` in settings) does the RPC call.
    // We return the values and let the caller handle loading/error.
    try {
      onResolve({ currentPassword: current, newPassword: newPw });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 sm:mx-0"
    >
      <h2 className="text-lg font-bold text-slate-900">修改管理密码</h2>

      {/* Current password */}
      <div className="mt-4">
        <span className="label">当前密码</span>
        <div className="relative">
          <input
            type={showCurrent ? "text" : "password"}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="field pr-10"
            placeholder="输入当前管理密码"
            autoFocus
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowCurrent((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-600"
          >
            {showCurrent ? "隐藏" : "显示"}
          </button>
        </div>
        {currentErr && (
          <p className="mt-1 text-xs text-rose-600" role="alert">
            {currentErr}
          </p>
        )}
      </div>

      {/* New password */}
      <div className="mt-3">
        <span className="label">新密码</span>
        <div className="relative">
          <input
            type={showNew ? "text" : "password"}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="field pr-10"
            placeholder="输入新管理密码（至少 6 位）"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowNew((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-600"
          >
            {showNew ? "隐藏" : "显示"}
          </button>
        </div>
        {newErr && (
          <p className="mt-1 text-xs text-rose-600" role="alert">
            {newErr}
          </p>
        )}
      </div>

      {/* Confirm new password */}
      <div className="mt-3">
        <span className="label">确认新密码</span>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field pr-10"
            placeholder="再次输入新密码"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-600"
          >
            {showConfirm ? "隐藏" : "显示"}
          </button>
        </div>
        {confirmErr && (
          <p className="mt-1 text-xs text-rose-600" role="alert">
            {confirmErr}
          </p>
        )}
      </div>

      {/* Error from server */}
      {error && (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={busy}
          onClick={() => onResolve(null)}
        >
          取消
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={busy}
        >
          {busy ? "修改中…" : "确认修改"}
        </button>
      </div>
    </form>
  );
}
