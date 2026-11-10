# aiayi Strategi A dan B — version frozen 2026-10-18

Node.js >=18 standard libraries; no paid API, no network, no npm install.
The dashboard "UTS_25110200029_Ai Zahara Salsa Nabila Hasibuan.html" is already included in this zip, beside these files. Run:
node reproduce.cjs "UTS_25110200029_Ai Zahara Salsa Nabila Hasibuan.html"
The script decompresses the original embedded source data and reruns all42 counted UTS
portfolio simulations, IS/OOS, sensitivity, walk-forward, delay, cost tests, and diagnostics.
The HTML contains explicit JSON equity/trades and a complete frozen evidence snapshot.
Independent assertions check netPnL=grossPnL-fees-spread, cash, lot, maxpositions,
tick rounding, prefix stability; additional metrics validation is in verify.cjs.

Strategy unchanged entry logic: A breakout100+0.5%, EMA50/200, slope20, ROC252,
median turnover60>=Rp500m, cooldown10sessions; B monthly first-session close,
top16 positive momentum12-1, risingEMA200 and turnover60>=Rp5b. B max8, A max6,
total12. Shared fixed initial4ATR20 stop or two consecutive closes belowEMA100,
next open. No ranking exit, no C. Sizing risk1.5%, aggregate9%, maxweight15%,
breadth cap90/45/0%, correlation60>0.75 group25%, no margin/short.
Order q fixed at signal close; buy next open only rawOpen<=signalClose+ATR,
A also rawOpen>=breakout; no order replacement. Spread+ticking may put the
effective price beyond the raw-open condition; it is not a guaranteed limit fill.
Settle sell proceeds after3market sessions. Compounding on marked equity.

UTS cost model: buy0.15%, sell0.25%, each side at least1 adverse price tick,
then buy ceil/sell floor to valid BEI tick. Cost2 doubles fee and tick offset.
Cost0 uses raw prices without rounding. All orders100shares, <=1% ADVshares20
and <=5% ADVvalue20 from before execution. Sales also capped5% ADVvalue20;
full-size exits defer if above capacity (no partial fills). Applying100shares/tick grid to the
entire history is an assignment simplification, not an assertion of historical rules.
Prior-bar feasibility filter and ex-post zero-volume execution rejection are used.
Current-day zero-volume is execution availability, NOT a pre-open strategy input.
Actual open access, locked ARA/ARB, suspension and queues remain UNVERIFIED.

Sharpe monthly sampleSD annualizedsqrt12, rf0. Daily MTM MDD. CAGR requested
calendar endpoints divided365.25. Newrecord uses monthend>=all prior DAILY highs.
Drought counts consecutive monthends without newrecord. Costshare uses all entry/
exit fees+spread (including open positions) / (ending-initial+those costs), undefined
if denominator<=0. Avg return denominator is entry effective notional+entryfee.
Closed trades only PF/WR; floating positions separate, no fictitious forced closes.

IS70/30 is retrospective: data already seen, NOT clean holdout. Independent account
reset per partition with prior price warmup. WF4yrtrain/2yrtest, optimize only bTop
8/16/24 by ISCalmar, ties nearest16; terminal liquidation before cash carry forward,
with fees and spread. Sensitivity5parameters +/-20/50 one factor at a time.
42counted simulations;12training candidates; prior118legacy runs plus earlier
untracked experiments: total lifetime research count UNKNOWN. Withouttop5 removes
economic contribution of five ex-post best trades, other quantities unchanged;
it is a fixed-path diagnosis, not a tradable rule or portfolio reallocation.
Benchmark is real source ASII singleasset price-only buyhold with entry and terminal
exit costs on same2016–2025dates, not an IHSG proxy or totalreturn index.

Pending before claiming compliance:4weeks real postfreeze papertrading; identityclass;
original provider/download date; historical Kompas100 membership/delistings;
consistent corporate action adjustments; historical trade availability/ARAARB.
AI: ChatGPT/Codex implemented code/UI/tests/explanation. Student must review and
understand results; no signed student-authorship declaration is fabricated.
No real-browser visual QA claimed; DOM simulation and Node worker tests only.

Identity: Ai Zahara Salsa Nabila, NIM 25110200029. Class/source download details pending.
AI: ChatGPT/Codex implemented integration, UI and tests. Student review pending.
No Chart.js CDN required.
Source: supplied kompas100ODS SHA256 in source_audit.json;487049 weekday valid bars,
100names through27Jul2026. Data contain no genuine historical constituent list.
ODS data are embedded as compressed OHLCV, not the14MB binary ODS; original input
can be extracted with bundled extract_ods.py. No internet needed to rerun fromHTML.
Reference AFL in references/ is the older fee/slippage model. It is documentation,
NOT the native runtime producing UTS metrics. Native AmiBroker compilation untested.
UTS results use engine_uts.cjs with asymmetric fee, adverse tick and lot100.
CSV import replaces only the interactive account; the UTS frozen evidence stays on
the original ODS snapshot. Journal/benchmark/theme keys are isolated from Ell's dashboard.
