# Lodestar

A Windows desktop terminal that puts live world events on a 3D globe next to the markets they tend to move, with fully local paper trading.

- **Live events:** earthquakes (USGS), hurricanes and typhoons (NOAA NHC, GDACS), fires, volcanoes and floods (NASA EONET), and geolocated world news from public RSS feeds, sorted into conflict and news.
- **Globe and map:** night, dark and NASA VIIRS satellite views, storm tracks, pulsing alerts, and a flat map with zoom.
- **Markets:** delayed quotes and candle charts for energy, metals, grains, defense, risk gauges and crypto.
- **Paper trading:** multiple local accounts, long and short positions, fees, stop and target exits, position and daily-loss limits, equity curve and CSV export. Nothing is ever sent to a broker.

Linked markets on an event are descriptive context, not trading signals.

## Install

Download `Lodestar-Setup-<version>.exe` from [Releases](../../releases). The installer isn't code-signed, so Windows SmartScreen may ask you to confirm. Installed copies update themselves from new releases.

## Develop

```bash
npm install
npm start
```

Build the installer with `npm run dist`. Publish a release (needs `GH_TOKEN`) with `npm run release` after bumping `version` in `package.json`.
