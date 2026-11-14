# Lodestar

A Windows desktop terminal that puts live world events on a 3D globe next to the markets they tend to move, with fully local paper trading.

- **Live events:** earthquakes (USGS), hurricanes and typhoons (NOAA NHC, GDACS), fires, volcanoes and floods (NASA EONET), and geolocated world news from public RSS feeds, sorted into conflict and news.
- **Globe and map:** night, dark and NASA VIIRS satellite views, storm tracks, pulsing alerts, and a flat map with zoom.
- **Markets:** delayed quotes and candle charts for energy, metals, grains, defense, risk gauges and crypto.
- **Paper trading:** go long or short on any market, with fees, stops and targets, position and daily-loss limits, several local accounts and CSV export. Nothing is ever sent to a broker.
- **Autopilot:** one switch starts a separate paper account that trades by itself, long and short, using two readable rules (event reaction and trend). The Portfolio view shows its equity, exposure, positions, orders and a plain-language activity log. It keeps running from the tray when the window is closed. Neither rule has a proven edge.
- **Looks:** night, satellite and dark surfaces, plus Thermal, NVG, CRT and Noir filters.

Linked markets on an event are descriptive context, not trading signals. The layout is modelled on [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (MIT); see THIRD_PARTY_NOTICES.md.

## Install

Download `Lodestar-Setup-<version>.exe` from [Releases](../../releases). The installer isn't code-signed, so Windows SmartScreen may ask you to confirm. Installed copies update themselves from new releases.

## Develop

```bash
npm install
npm start
```

Build the installer with `npm run dist`. Publish a release (needs `GH_TOKEN`) with `npm run release` after bumping `version` in `package.json`.
