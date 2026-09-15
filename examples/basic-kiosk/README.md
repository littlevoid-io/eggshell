# basic-kiosk

A real, working app built on `eggshell`, showing how to use it from your own Electron main file.

## Setup

This example depends on the `eggshell` package right next to it via `file:../..`, so build that first:

```sh
# In the repository root:
npm run build
```

## Running it

```sh
# In this directory (examples/basic-kiosk):
npm install
npm run dev
```

This opens two windows — one on the primary display, and one targeting a touch-capable display if it finds one (it falls back to the primary display otherwise). It also turns on the offline overlay and the remote dashboard plugins, so you can see those working too. Everything stays open until you close it.

To run it non-interactively instead — it launches, logs what it did, then quits after 5 seconds, which is handy for automated checks:

```sh
EGGSHELL_EXAMPLE_AUTOQUIT=1 npm run dev
```
