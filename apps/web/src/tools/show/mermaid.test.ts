import { describe, expect, it } from 'vitest';

import { mountIdOf, withMountId } from './mermaid';

describe('withMountId', () => {
  const svg = [
    '<svg id="fcshowmmd-3" width="100%" aria-roledescription="flowchart-v2">',
    '<style>#fcshowmmd-3{font-family:sans}#fcshowmmd-3 .node rect{fill:#363a4f}</style>',
    '<marker id="fcshowmmd-3_flowchart-v2-pointEnd"></marker>',
    '<path marker-end="url(#fcshowmmd-3_flowchart-v2-pointEnd)"></path>',
    '<text>fcshowmmd and fcshow-3 stay</text>',
    '</svg>',
  ].join('');

  it('moves the root id, the style selectors and the marker references together', () => {
    const mounted = withMountId(svg, 'fcshowmmd-3', 'fcshow-r7');
    expect(mounted).toContain('<svg id="fcshow-r7"');
    expect(mounted).toContain('#fcshow-r7{font-family:sans}#fcshow-r7 .node rect');
    expect(mounted).toContain('<marker id="fcshow-r7_flowchart-v2-pointEnd">');
    expect(mounted).toContain('url(#fcshow-r7_flowchart-v2-pointEnd)');
    expect(mounted).not.toContain('fcshowmmd-3');
  });

  it('leaves diagram text alone', () => {
    expect(withMountId(svg, 'fcshowmmd-3', 'fcshow-r7')).toContain(
      '<text>fcshowmmd and fcshow-3 stay</text>',
    );
  });

  it('gives each mount a distinct id safe in selectors', () => {
    expect(mountIdOf('«r1»')).toBe('fcshow-r1');
    expect(mountIdOf(':r2:')).toBe('fcshow-r2');
    expect(mountIdOf('_r_3_')).toBe('fcshow-_r_3_');
  });
});
