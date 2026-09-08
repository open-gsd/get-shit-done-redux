---
type: Fixed
pr: 0
---
**`roadmap analyze` no longer mints a phantom phase from a mid-line mention** — a sentence, blockquote, or inline-code-span reference to a `### Phase N:`-shaped heading anywhere in the ROADMAP was previously counted as a real phase, inflating `phase_count` and able to collide on a phase number with a real heading nearby. The phase-heading extraction is now anchored to line start, matching this repo's other heading parsers.
