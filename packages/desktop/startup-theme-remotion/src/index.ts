/**
 * Remotion entry point.
 *
 * `remotion studio` and `remotion render` load this file and require it to
 * call `registerRoot()` with the Root component that registers <Composition>s.
 */
import { registerRoot } from 'remotion';
import { Root } from './Root';

registerRoot(Root);
