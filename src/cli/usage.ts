export const USAGE_TEXT = `Usage: eggshell <command> [options]

Commands:
  dev       Start application in development mode
            Options:
              --project-root <dir>   Project root directory (default: current working directory)
              --entry <path>         Compiled main entry path (default: dist/main.js)
              --user-data-dir <dir>  Override userData directory

  build     Build standalone distribution using electron-builder
            Options:
              --project-root <dir>   Project root directory (default: current working directory)
              --user-data-dir <dir>  Override userData directory

  start     Start built production application
            Options:
              --project-root <dir>   Project root directory (default: current working directory)
              --manifest-path <path> Path to eggshell.launch.json (searched in release/ if omitted)
              --user-data-dir <dir>  Override userData directory

  doctor    Run preflight diagnostics on environment and configuration
            Options:
              --project-root <dir>   Project root directory (default: current working directory)
              --user-data-dir <dir>  Override userData directory

  init      Scaffold a new eggshell kiosk consumer project
            Arguments:
              <targetDir>            Target directory (default: current working directory)
            Options:
              --product-name <name>  Product display name
              --app-id <id>          Reverse-DNS application identifier

Global options:
  -h, --help  Show help text
`;

export function printUsage(toStderr: boolean = false): void {
  const target = toStderr ? process.stderr : process.stdout;
  target.write(USAGE_TEXT);
}
