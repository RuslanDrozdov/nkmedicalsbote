import type { CopyKey, Lang } from "../../copy";
import { t } from "../../copy";

type Props = {
  lang: Lang;
  labelKey: CopyKey;
  onClick: () => void;
};

export default function BrainBackButton({ lang, labelKey, onClick }: Props) {
  return (
    <button type="button" className="brain-back-btn" onClick={onClick}>
      {t(lang, labelKey)}
    </button>
  );
}
