# pi-cycle

A pi extension for quickly cycling between model tiers using keyboard shortcuts.

## Features

- Use `z`, `zz`, or `zzz` as a prefix to your message to automatically switch to the corresponding tier's model.
- Cycle through multiple models within a single tier.
- Configure tiers via a GUI or command line.

## Usage

- `z <message>`: Switch to Tier 1 and send message.
- `zz <message>`: Switch to Tier 2 and send message.
- `zzz <message>`: Switch to Tier 3 and send message.
- `/cycle-models show`: Show current tier mappings.
- `/cycle-models <1|2|3>`: Configure models for a specific tier.
- `/cycle-models shortcut {shortcut}`: Change the prefix shortcut (default: `z`).
- `/cycle-models`: Configure all tiers.

## Installation

Copy `pi-cycle.ts` to your `~/.pi/agent/extensions/` directory.

## License

MIT
