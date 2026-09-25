import { RegistryContext } from '@effect/atom-react';
import { useContext, useEffect, useRef, useState } from 'react';

import type { AnalysisHandle } from '../visuals';
import { DevPanel } from './DevPanel';
import {
  createMockDriver,
  isScenarioId,
  type MockDriver as Driver,
  type ScenarioId,
} from './driver';
import { createSyntheticVoice } from './synthetic';

const initialScenario = (): ScenarioId => {
  const requested = new URLSearchParams(window.location.search).get('scenario');
  return isScenarioId(requested) ? requested : 'fresh';
};

/**
 * Installs the fixture data source for phase 2: fixture scenarios into the atoms, scripted commands, and the synthetic voice
 * into the page's analysis handle. `?scenario=<id>` picks the starting scenario. The panel shows only in development.
 */
export function MockDriver({ analysis }: { readonly analysis: AnalysisHandle }) {
  const registry = useContext(RegistryContext);
  const driver = useRef<Driver | null>(null);
  const [scenario, setScenario] = useState<ScenarioId>(initialScenario);

  useEffect(() => {
    const voice = createSyntheticVoice();
    analysis.connect(voice.source);
    const created = createMockDriver(registry, voice, setScenario);
    driver.current = created;
    created.load(initialScenario());
    return () => {
      created.dispose();
      analysis.connect(null);
      driver.current = null;
    };
  }, [registry, analysis]);

  return import.meta.env.DEV ? (
    <DevPanel current={scenario} onPick={(id) => driver.current?.load(id)} />
  ) : null;
}
