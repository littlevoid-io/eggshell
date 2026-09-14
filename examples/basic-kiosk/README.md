# basic-kiosk

A real example consumer app built on `eggshell`, demonstrating how to launch the shell programmatically.

## Setup

Because this example depends on the parent `eggshell` package via `file:../..`, you must build the root package first:

```sh
# In the repository root:
npm run build
```

## Running the Example

```sh
# In this directory (examples/basic-kiosk):
npm install
npm run dev
```

This will launch a single window displaying a local static HTML page, using `eggshell`'s programmatic API. The window stays open until you close it.

To run it non-interactively (used for automated verification — it launches, logs, then quits after 5 seconds):

```sh
EGGSHELL_EXAMPLE_AUTOQUIT=1 npm run dev
```
