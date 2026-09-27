import type { ShownShow } from './model';
import { ShowContent } from './ShowContent';
import { ShowHeader } from './ShowHeader';

/** The desktop Show card: title bar and scrolling body. Its container animates it in and out. */
export function ShowPanel({
  show,
  onClose,
}: {
  readonly show: ShownShow;
  readonly onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line/40 bg-subtle/60 shadow-soft backdrop-blur-xl backdrop-saturate-130">
      <ShowHeader input={show.input} onClose={onClose} className="border-b border-line/25" />
      <ShowContent input={show.input} body={show.body} correction={show.correction} />
    </div>
  );
}
