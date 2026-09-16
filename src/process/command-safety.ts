import { existsSync } from 'node:fs';
import { ProcessError } from '../errors.js';

const SHELL_METACHARACTER_PATTERN = /[&|;`$()<>"']/;
const WHITESPACE_PATTERN = /\s/;

function checkMetacharacters(id: string, command: string): void {
  if (SHELL_METACHARACTER_PATTERN.test(command)) {
    throw new ProcessError(
      `process "${id}": command ${JSON.stringify(command)} contains a shell metacharacter. ` +
        'spawnManaged never uses a shell, so none of these can do anything useful in a real ' +
        'command — this is almost certainly a mistake. Split any arguments into "args" ' +
        '(a separate argv array), never joined into "command".',
      { processId: id }
    );
  }
}

function checkWhitespaceCommand(id: string, command: string): void {
  if (WHITESPACE_PATTERN.test(command) && !existsSync(command)) {
    throw new ProcessError(
      `process "${id}": command ${JSON.stringify(command)} contains whitespace and is not a ` +
        'real, existing file. spawnManaged never uses a shell, so a joined string like ' +
        '"node -e 1" is looked up as one literal executable name and fails obscurely instead ' +
        'of doing what it looks like it should. Split it into "command" (the executable only) ' +
        'and "args" (the separate argv array) — or, if this really is meant to be a single ' +
        'path containing a space, double-check it actually exists.',
      { processId: id }
    );
  }
}

export function assertSafeCommand(id: string, command: string): void {
  checkMetacharacters(id, command);
  checkWhitespaceCommand(id, command);
}
