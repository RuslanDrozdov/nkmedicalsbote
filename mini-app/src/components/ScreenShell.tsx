import type { ReactNode } from "react";
import type { CopyKey, Lang } from "../copy";
import { t } from "../copy";

type Props = {
  lang: Lang;
  title?: string;
  onBackHome?: () => void;
  onBack?: () => void;
  backLabel?: CopyKey;
  children: ReactNode;
};

export default function ScreenShell({ lang, title, onBackHome, onBack, backLabel, children }: Props) {
  const back = onBack ?? onBackHome;
  return (
    <div className="panel">
      <div className="panel-inner layout">
        {back ? (
          <button type="button" className="back-btn" onClick={back}>
            {t(lang, backLabel ?? "backHome")}
          </button>
        ) : null}
        {title ? <h1>{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}
