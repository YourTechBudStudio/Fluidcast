import { MockPanel } from '../MockPanel';
import { MODE_STATES, MODE_SUMMARY, useModeMock } from './model';
import { ModeScreen } from './ModeScreen';

/** Assumptions the mock makes that the design docs don't settle. Shown in the mock panel. */
const NOTES = [
  'The ID hint (“/status in Claude Code”) is inferred, not verified.',
  'Submitting text that isn’t a UUID shows the “invalid ID” error; the backend checks it too.',
  'Continue goes on to the session mock after its pending state; New brainstorm returns to idle (no backend here).',
];

export function ModeMock() {
  const mock = useModeMock();
  return (
    <>
      <ModeScreen mock={mock} />
      <MockPanel
        title="Mode screen"
        summary={MODE_SUMMARY}
        controls={[
          {
            label: 'State',
            value: mock.state,
            options: MODE_STATES,
            onChange: (s) => mock.setState(s as typeof mock.state),
          },
        ]}
        notes={NOTES}
      />
    </>
  );
}
