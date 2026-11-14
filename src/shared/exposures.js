// Markets commonly linked to an event type and place, with the direction they
// usually move (dir: +1 up, -1 down, 0 = named but direction unclear).
// Shared by the renderer (context cards) and the autopilot (trade ideas).
// These are textbook relationships, not tested trading signals.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LodestarExposures = api;
}(typeof self !== 'undefined' ? self : this, () => {
  function exposures(e) {
    const out = [];
    const add = (symbol, why, dir) => { if (!out.some((o) => o.symbol === symbol)) out.push({ symbol, why, dir }); };
    const r = e.region;
    const text = `${e.title} ${e.summary || ''} ${e.place || ''}`.toLowerCase();
    const mag = (e.meta && e.meta.mag) || 0;

    if (e.kind === 'conflict' || e.kind === 'news') {
      if (r === 'middle_east') {
        add('BZ=F', 'Gulf and Red Sea supply routes', 1); add('CL=F', 'Crude risk premium', 1);
        add('GC=F', 'Safe-haven demand', 1); add('ITA', 'Defense spending', 1);
      }
      if (r === 'russia_ukraine') {
        add('NG=F', 'European gas supply', 1); add('ZW=F', 'Black Sea grain exports', 1);
        add('ITA', 'Defense spending', 1); add('GC=F', 'Safe-haven demand', 1);
      }
      if (/taiwan|china|chinese|beijing|south china sea|korea|pyongyang|japan|\bpla\b/.test(text)) {
        add('TSM', 'Taiwan chip supply', -1); add('ITA', 'Defense spending', 1); add('^VIX', 'Risk sentiment', 1);
      }
      if (r === 'europe' && e.kind === 'conflict') { add('ITA', 'Defense spending', 1); add('NG=F', 'European energy', 1); }
      if (/congo|drc|zambia/.test(text)) add('HG=F', 'Copper and cobalt mining', 1);
      if (/venezuela/.test(text)) add('CL=F', 'Venezuelan crude', 1);
      if (/\b(oil|crude|opec|refiner\w*|tanker\w*|pipeline\w*)\b/.test(text)) { add('CL=F', 'Oil named in story', 0); add('BZ=F', 'Oil named in story', 0); }
      if (/\b(lng|natural gas|gas field|gas supply)\b/.test(text)) add('NG=F', 'Gas named in story', 0);
      if (/\b(wheat|grain|corn|harvest)\b/.test(text)) add('ZW=F', 'Grain named in story', 0);
      if (/\bgold\b/.test(text)) add('GC=F', 'Gold named in story', 0);
      if (e.kind === 'conflict' && !out.length) { add('ITA', 'Defense spending', 1); add('GC=F', 'Safe-haven demand', 1); }
    }
    if (e.kind === 'storm') {
      if (r === 'gulf_of_mexico') {
        add('NG=F', 'Gulf gas production', 1); add('CL=F', 'Gulf offshore output', 1);
        add('RB=F', 'Gulf Coast refineries', 1); add('TRV', 'Insured losses', -1);
      } else if (r === 'americas') { add('TRV', 'Insured losses', -1); add('RB=F', 'Fuel distribution', 1); }
      else if (r === 'east_asia') add('TSM', 'Fab and port disruption', -1);
    }
    if (e.kind === 'quake' && mag >= 5.5) {
      if (/japan|taiwan/.test(text)) add('TSM', 'Chip fabs', -1);
      if (/chile|peru/.test(text)) add('HG=F', 'Copper mines', 1);
      if (/california|alaska|oregon|washington/.test(text)) add('TRV', 'Insured losses', -1);
      if (/turkey|iran|iraq/.test(text)) add('BZ=F', 'Regional pipelines', 1);
    }
    if (e.kind === 'fire' && r === 'americas') add('TRV', 'Insured losses', -1);
    if ((e.kind === 'flood' || e.kind === 'weather') && /brazil|argentina|iowa|illinois|nebraska|india|ukraine|russia|australia|drought|kenya|ethiopia/.test(text)) {
      add('ZC=F', 'Crop conditions', 1); add('ZS=F', 'Crop conditions', 1); add('ZW=F', 'Crop conditions', 1);
    }
    return out.slice(0, 5);
  }
  return { exposures };
}));
