// ─── Beacon PDF Generator ─────────────────────────────────────────────────────
// PDFKit-based report builder. Streams directly to the HTTP response.
//
// Key design decisions:
//   - No bufferPages — footers are added on page-leave, not post-hoc.
//     This eliminates blank trailing pages entirely.
//   - Up/down arrows drawn as vector paths (PDFKit moveTo/lineTo),
//     because Helvetica doesn't contain Unicode triangle glyphs.
//   - All backgrounds use solid colours — PDFKit ignores hex alpha (#rrggbbaa).
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require("pdfkit");
const { PDF_METRICS, PDF_TOPIC_LABELS, COHORT_LABELS } = require("./reportDefinitions");

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  navy:         "#0c1e38",
  navyDeep:     "#050d1a",
  electric:     "#3b82f6",
  electricDim:  "#1e4a8a",
  electricLight:"#dbeafe",
  success:      "#10b981",
  successLight: "#d1fae5",
  successDark:  "#065f46",
  warning:      "#f59e0b",
  warningLight: "#fef3c7",
  warningDark:  "#78350f",
  error:        "#ef4444",
  errorDark:    "#7f1d1d",
  text:         "#1a2a3a",
  textMid:      "#2d4a6b",
  textLight:    "#4a6080",
  textFaint:    "#8fa3c0",
  border:       "#c8d8ec",
  borderLight:  "#e8f0f8",
  rowAlt:       "#f4f8fd",
  white:        "#ffffff",
};

// ─── Page geometry ────────────────────────────────────────────────────────────
const MARGIN   = 52;
const PAGE_W   = 595.28;   // A4
const PAGE_H   = 841.89;
const CONT_W   = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 36;
const USABLE_H = PAGE_H - MARGIN - 70;  // content zone: leaves 70px for footer + gap

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtPct   = v => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const fmtCount = v => v == null ? "—" : Number(v).toLocaleString();

function fmtValue(v, unit) {
  if (unit === "rate" || unit === "pct") return fmtPct(v);
  if (unit === "count") return fmtCount(v);
  return v == null ? "—" : String(v);
}

// Returns { label, direction: "up"|"down"|null }
function fmtDelta(v, unit) {
  if (v == null || v === 0) return { label: "—", direction: null };
  const abs  = Math.abs(v);
  const sign = v > 0 ? "+" : "-";
  const label = (unit === "rate" || unit === "pct")
    ? `${sign}${(abs * 100).toFixed(1)}pp`
    : unit === "count" ? `${sign}${fmtCount(abs)}`
    : `${sign}${abs.toFixed(1)}`;
  return { label, direction: v > 0 ? "up" : "down" };
}

function deltaColor(direction, goodDir) {
  if (!direction) return C.textLight;
  const good = (goodDir === "up" && direction === "up") ||
               (goodDir === "down" && direction === "down");
  return good ? C.success : C.error;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtPeriod = p => {
  const m = p?.match(/^(\d{4})-M(\d{1,2})$/);
  return m ? `${MONTHS[parseInt(m[2],10)-1]} ${m[1]}` : (p ?? "");
};

// Clip string to approximate character count for narrow columns
const clip = (s, maxCh) => (!s || s.length <= maxCh) ? (s ?? "—") : s.slice(0, maxCh-1) + "…";

// ─── BeaconPDFGenerator ───────────────────────────────────────────────────────
class BeaconPDFGenerator {
  constructor(config, data) {
    this.config = config;
    this.data   = data;

    this.doc = new PDFDocument({
      size:    "A4",
      margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN },
      // No bufferPages — footers added on page-leave to prevent blank trailing pages
      info: {
        Title:   `Beacon Member Insights — ${config.fund_org.display_name}`,
        Author:  "Beacon — save2retire Pty Ltd",
        Subject: "Member insights and APRA retirement income covenant evidence",
      },
    });

    this.y          = MARGIN;
    this._pageNum   = 0;           // 0 = cover (no footer), 1+ = content pages
    this._freshPage = false;       // true immediately after _newPage() — suppresses double-adds
  }

  pipe(stream) { this.doc.pipe(stream); return this; }

  end() { this.doc.end(); }

  // ── Build ─────────────────────────────────────────────────────────────────
  async build() {
    const { sections } = this.config;
    for (const id of sections) {
      if (id === "cover")             this._buildCover();
      if (id === "executive_summary") this._buildExecutiveSummary();
      if (id === "engagement")        this._buildMetricSection("engagement");
      if (id === "preparedness")      this._buildMetricSection("preparedness");
      if (id === "topics")            this._buildTopicsSection();
      if (id === "behaviour")         this._buildMetricSection("behaviour");
      if (id === "methodology")       this._buildMethodology();
    }
    // Footer on the final page (no next page to trigger it)
    this._writeFooter();
  }

  // ── Page management ───────────────────────────────────────────────────────

  _newPage() {
    this._writeFooter();     // footer on the page we're leaving
    this.doc.addPage();
    this.y         = MARGIN;
    this._pageNum += 1;
    this._freshPage = true;
  }

  // Write the footer on the current page (skipped on cover page 0)
  _writeFooter() {
    if (this._pageNum === 0) return;
    this.doc
      .font("Helvetica").fontSize(8).fillColor(C.textFaint)
      .text(
        `${this.config.fund_org.display_name}  ·  Beacon Member Insights  ·  Confidential  ·  Page ${this._pageNum}`,
        MARGIN, FOOTER_Y, { width: CONT_W, align: "center", lineBreak: false }
      );
    // Thin rule above footer
    this.doc.moveTo(MARGIN, FOOTER_Y - 6).lineTo(MARGIN + CONT_W, FOOTER_Y - 6)
      .strokeColor(C.borderLight).lineWidth(0.4).stroke();
  }

  _checkSpace(needed) {
    if (!this._freshPage && this.y + needed > USABLE_H) {
      this._newPage();
    }
    this._freshPage = false;
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────

  _rule(color = C.border, w = 0.5) {
    this.doc.moveTo(MARGIN, this.y).lineTo(MARGIN + CONT_W, this.y)
      .strokeColor(color).lineWidth(w).stroke();
    this.y += 1;
  }

  // Draw a filled up (direction="up") or down triangle at absolute (ax, ay)
  _triangle(direction, ax, ay, size, color) {
    this.doc.save().fillColor(color).lineWidth(0);
    if (direction === "up") {
      this.doc.moveTo(ax + size / 2, ay)
              .lineTo(ax + size,     ay + size)
              .lineTo(ax,            ay + size)
              .closePath().fill();
    } else {
      this.doc.moveTo(ax,            ay)
              .lineTo(ax + size,     ay)
              .lineTo(ax + size / 2, ay + size)
              .closePath().fill();
    }
    this.doc.restore();
  }

  _sectionHeading(text, sub = null) {
    this._checkSpace(72);
    this.y += 14;
    // Blue left bar
    this.doc.rect(MARGIN, this.y, 4, sub ? 36 : 24).fill(C.electric);
    this.doc.font("Helvetica-Bold").fontSize(15).fillColor(C.navy)
      .text(text, MARGIN + 12, this.y, { width: CONT_W - 12, lineBreak: false });
    this.y += 20;
    if (sub) {
      this.doc.font("Helvetica").fontSize(10).fillColor(C.textLight)
        .text(sub, MARGIN + 12, this.y, { width: CONT_W - 12, lineBreak: false });
      this.y += 16;
    }
    this.y += 8;
  }

  _subHeading(text) {
    this._checkSpace(32);
    this.y += 8;
    this.doc.font("Helvetica-Bold").fontSize(11).fillColor(C.electricDim)
      .text(text, MARGIN, this.y, { width: CONT_W, lineBreak: false });
    this.y += this.doc.currentLineHeight() + 5;
  }

  _bodyText(text) {
    this._checkSpace(28);
    this.doc.font("Helvetica").fontSize(10).fillColor(C.text)
      .text(text, MARGIN, this.y, { width: CONT_W, lineGap: 2 });
    this.y += this.doc.heightOfString(text, { width: CONT_W, lineGap: 2 }) + 8;
  }

  // Callout box — solid bg (no alpha)
  _callout(text, color = C.electric) {
    const bgMap = {
      [C.electric]: { bg: C.electricLight, fg: C.textMid },
      [C.warning]:  { bg: C.warningLight,  fg: C.warningDark },
      [C.success]:  { bg: C.successLight,  fg: C.successDark },
      [C.error]:    { bg: "#fee2e2",        fg: C.errorDark },
    };
    const { bg, fg } = bgMap[color] ?? { bg: C.electricLight, fg: C.textMid };

    this._checkSpace(56);
    const h = this.doc.heightOfString(text, { width: CONT_W - 28, lineGap: 2 }) + 20;
    this.doc.rect(MARGIN, this.y, CONT_W, h).fill(bg);
    this.doc.rect(MARGIN, this.y, 4, h).fill(color);
    this.doc.rect(MARGIN, this.y, CONT_W, h).strokeColor(color).lineWidth(0.4).stroke();
    this.doc.font("Helvetica").fontSize(10).fillColor(fg)
      .text(text, MARGIN + 14, this.y + 10, { width: CONT_W - 24, lineGap: 2 });
    this.y += h + 10;
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  // cols: [{ label, width, align? }]  — widths relative, scaled to CONT_W
  // Cell: string | { label, color?, bold?, align?, arrow? }
  //   arrow: "up" | "down" — draws a coloured vector triangle before the label
  _table(cols, rows, opts = {}) {
    const {
      headerBg    = C.navy,
      headerColor = C.white,
      rowBg       = [C.white, C.rowAlt],
      rowH        = 22,
      fs          = 9,
      title       = null,   // subheading rendered as part of table so it stays together
    } = opts;

    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const sc     = cols.map(c => ({ ...c, width: Math.floor(c.width * CONT_W / totalW) }));
    const PAD    = 5;
    const HDR_H  = rowH + 4;
    const TRI    = 7;    // triangle size px
    const TRI_GAP = 4;   // gap between triangle and label

    // ── Page break check: keep whole table together if it fits on one page ──
    const totalTableH = HDR_H + rows.length * rowH + 12;
    const fitsOnFullPage = MARGIN + totalTableH <= USABLE_H;
    const fitsOnCurrentPage = this.y + totalTableH <= USABLE_H;

    if (!this._freshPage && !fitsOnCurrentPage && fitsOnFullPage) {
      // Table won't fit here but fits on a fresh page — start one
      this._newPage();
    } else if (!fitsOnCurrentPage && !fitsOnFullPage) {
      // Table is longer than a full page — just ensure at least header + 2 rows fit here
      this._checkSpace(HDR_H + rowH * 2);
    }

    // ── Header (extracted so it can be repeated after mid-table page breaks) ──
    let x = MARGIN;  // hoisted — shared between drawHeader and the row loop
    const drawHeader = () => {
      x = MARGIN;
      this.doc.rect(MARGIN, this.y, CONT_W, HDR_H).fill(headerBg);
      sc.forEach(col => {
        const maxCh = Math.floor(col.width / (fs * 0.56));
        this.doc.font("Helvetica-Bold").fontSize(fs - 1).fillColor(headerColor)
          .text(clip(col.label, maxCh), x + PAD, this.y + 7, {
            width: col.width - PAD * 2, align: col.align ?? "left", lineBreak: false,
          });
        x += col.width;
      });
      this.y += HDR_H;
    };
    drawHeader();

    // ── Rows ──
    rows.forEach((row, ri) => {
      const pageBefore = this._pageNum;
      this._checkSpace(rowH + 2);
      // If a page break just happened, repeat the header on the new page
      if (this._pageNum !== pageBefore) drawHeader();
      x = MARGIN;
      this.doc.rect(MARGIN, this.y, CONT_W, rowH).fill(rowBg[ri % 2]);

      sc.forEach((col, ci) => {
        const cell    = row[ci];
        const isObj   = typeof cell === "object" && cell !== null;
        const rawLabel = isObj ? (cell.label ?? "—") : String(cell ?? "—");
        const align   = (isObj && cell.align) ? cell.align : (col.align ?? "left");
        const color   = (isObj && cell.color) ? cell.color : C.text;
        const bold    = isObj && cell.bold;
        const arrow   = isObj ? cell.arrow : null;   // "up" | "down" | null
        const maxCh   = Math.floor(col.width / (fs * 0.52));
        const label   = clip(rawLabel, maxCh);

        if (arrow && label !== "—") {
          // Draw triangle + text together, right-aligned
          const textW  = this.doc.widthOfString(label, { fontSize: fs, font: bold ? "Helvetica-Bold" : "Helvetica" });
          const totalW = TRI + TRI_GAP + textW;
          const startX = x + col.width - PAD - totalW;
          const triY   = this.y + (rowH - TRI) / 2;

          this._triangle(arrow, startX, triY, TRI, color);

          this.doc
            .font(bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(fs).fillColor(color)
            .text(label, startX + TRI + TRI_GAP, this.y + (rowH - fs) / 2, {
              width: textW + 1, lineBreak: false,
            });
        } else {
          this.doc
            .font(bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(fs).fillColor(color)
            .text(label, x + PAD, this.y + (rowH - fs) / 2, {
              width: col.width - PAD * 2, align, lineBreak: false,
            });
        }
        x += col.width;
      });

      this.doc.moveTo(MARGIN, this.y + rowH).lineTo(MARGIN + CONT_W, this.y + rowH)
        .strokeColor(C.borderLight).lineWidth(0.3).stroke();
      this.y += rowH;
      this._freshPage = false;
    });

    this.doc.moveTo(MARGIN, this.y).lineTo(MARGIN + CONT_W, this.y)
      .strokeColor(C.border).lineWidth(0.5).stroke();
    this.y += 10;
  }

  // ── COVER PAGE ───────────────────────────────────────────────────────────
  _buildCover() {
    const { fund_org, period_start, period_end, audience_preset } = this.config;
    const doc = this.doc;

    doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.navyDeep);

    // Grid lines
    doc.strokeColor("#0d1f3a").lineWidth(0.35);
    for (let gx = 0; gx <= PAGE_W; gx += 44) doc.moveTo(gx,0).lineTo(gx,PAGE_H).stroke();
    for (let gy = 0; gy <= PAGE_H; gy += 44) doc.moveTo(0,gy).lineTo(PAGE_W,gy).stroke();

    doc.rect(0, 0, 6, PAGE_H).fill(C.electric);

    const lx = MARGIN + 10;

    doc.font("Helvetica-Bold").fontSize(36).fillColor(C.white).text("Beacon", lx, 72, { lineBreak:false });
    doc.font("Helvetica").fontSize(13).fillColor(C.textFaint)
       .text("Member Insights Platform  ·  save2retire Pty Ltd", lx, 116);

    doc.moveTo(lx, 144).lineTo(PAGE_W - MARGIN, 144).strokeColor(C.electricDim).lineWidth(1).stroke();

    doc.font("Helvetica-Bold").fontSize(30).fillColor(C.white)
       .text(fund_org.display_name, lx, 162, { width: CONT_W - 10 });

    const presetLabel = {
      board:   "Board Insights Pack",
      apra:    "APRA Retirement Income Covenant Evidence Pack",
      analyst: "Internal Analyst Report",
      custom:  "Member Insights Report",
    }[audience_preset] ?? "Member Insights Report";

    doc.font("Helvetica").fontSize(18).fillColor("#a0b8d8")
       .text(presetLabel, lx, 212, { width: CONT_W - 10 });

    const periodStr = period_start === period_end
      ? fmtPeriod(period_start)
      : `${fmtPeriod(period_start)} to ${fmtPeriod(period_end)}`;
    doc.font("Helvetica").fontSize(13).fillColor(C.textFaint).text(`Period: ${periodStr}`, lx, 254);
    doc.font("Helvetica").fontSize(11).fillColor("#3d5a7a")
       .text(`Generated: ${new Date().toLocaleDateString("en-AU",{day:"numeric",month:"long",year:"numeric"})}`, lx, 273);

    // Contents list
    const sNames = {
      executive_summary:"Executive Summary", engagement:"Member Engagement",
      preparedness:"Retirement Preparedness", topics:"AI Topic Intelligence",
      behaviour:"Behavioural Change", methodology:"Methodology Appendix",
    };
    const included = this.config.sections.filter(s => s !== "cover");
    if (included.length) {
      const bY = 308, bH = 20 + included.length * 18;
      doc.rect(lx, bY, CONT_W - 10, bH).fill("#0a1830");
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.textFaint).text("CONTENTS", lx + 12, bY + 7);
      included.forEach((s,i) => {
        doc.font("Helvetica").fontSize(10).fillColor("#8fa3c0")
           .text(`  ${i+1}.  ${sNames[s] ?? s}`, lx + 12, bY + 20 + i * 18);
      });
    }

    doc.rect(0, PAGE_H - 120, PAGE_W, 120).fill("#030b14");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#8fa3c0").text("Prepared by", lx, PAGE_H - 105);
    doc.font("Helvetica").fontSize(10).fillColor("#4a6080")
       .text("save2retire Pty Ltd  ·  insights.save2retire.ai", lx, PAGE_H - 90);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#8fa3c0").text("Confidential", lx, PAGE_H - 68);
    doc.font("Helvetica").fontSize(9).fillColor("#3d5a7a")
       .text("Prepared exclusively for the named recipient. Do not distribute without written consent.", lx, PAGE_H - 54, { width: CONT_W - 10 });

    this._newPage();  // move to page 1
  }

  // ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────────
  _buildExecutiveSummary() {
    const periods  = this.data.periods ?? [];
    const latest   = periods[periods.length - 1]?.period_label;
    const prev     = periods[periods.length - 2]?.period_label;
    const metrics  = PDF_METRICS.executive_summary;

    this._sectionHeading(
      "Executive Summary",
      `Key member insights  ·  ${fmtPeriod(this.config.period_start)}${this.config.period_start !== this.config.period_end ? ` to ${fmtPeriod(this.config.period_end)}` : ""}`
    );

    if (!latest) { this._bodyText("No data available for the selected period range."); return; }

    // Headline table — Metric | Latest | Prior | Change (with arrow)
    const cols = [
      { label: "Metric",                                  width: 165 },
      { label: fmtPeriod(latest),                        width: 78, align: "right" },
      { label: prev ? fmtPeriod(prev) : "Prior Period",  width: 78, align: "right" },
      { label: "Change",                                  width: 62, align: "right" },
    ];

    const rows = metrics.map(m => {
      const snap  = this._snap(latest, "ALL", m.key);
      const pSnap = prev ? this._snap(prev, "ALL", m.key) : null;
      const val   = snap?.metric_value;
      const pVal  = pSnap?.metric_value;
      const rawD  = val != null && pVal != null ? val - pVal : null;
      const d     = fmtDelta(rawD, m.unit);
      const dc    = deltaColor(d.direction, m.goodDir ?? "up");
      return [
        { label: m.label, bold: true },
        { label: fmtValue(val, m.unit),                               align: "right" },
        { label: pVal != null ? fmtValue(pVal, m.unit) : "—",        align: "right" },
        { label: d.label, color: dc, arrow: d.direction,              align: "right" },
      ];
    });

    this._table(cols, rows, { rowH: 24 });

    this._subHeading("Key Findings");
    const uv = this._snap(latest,"ALL","active_users")?.metric_value;
    const ai = this._snap(latest,"ALL","ai_tool_usage_rate")?.metric_value;
    const gp = this._snap(latest,"ALL","projection_gap_rate")?.metric_value;
    const gl = this._snap(latest,"ALL","goal_declaration_rate")?.metric_value;
    [
      uv ? `${fmtCount(uv)} active members engaged with the platform in ${fmtPeriod(latest)}.` : null,
      ai ? `${fmtPct(ai)} of active members used the AI information tool — evidencing ongoing engagement, not a one-time calculator.` : null,
      gl ? `${fmtPct(gl)} of active members have declared at least one retirement goal, providing a measurable proxy for planning engagement.` : null,
      gp ? `${fmtPct(gp)} of active members' base-case projections show a retirement shortfall — the addressable preparedness opportunity.` : null,
    ].filter(Boolean).forEach(f => this._bodyText(`   \u2022  ${f}`));
  }

  // ── METRIC SECTIONS ───────────────────────────────────────────────────────
  _buildMetricSection(id) {
    const META = {
      engagement:   { title:"Member Engagement",       sub:"Platform usage and AI tool adoption rates by cohort" },
      preparedness: { title:"Retirement Preparedness", sub:"Adequacy and planning behaviour indicators" },
      behaviour:    { title:"Behavioural Change",      sub:"Evidence of sustained member behaviour change — APRA retirement income covenant" },
    };
    const { title, sub }  = META[id];
    const metrics         = PDF_METRICS[id] ?? [];
    const isDetailed      = this.config.detail_level !== "summary";
    const cohorts         = isDetailed ? ["ALL","C1","C2","C3","C4","C5"] : ["ALL"];
    const periods         = this.data.periods ?? [];
    const latest          = periods[periods.length - 1]?.period_label;
    const prev            = periods[periods.length - 2]?.period_label;

    this._sectionHeading(title, sub);

    if (id === "behaviour") {
      this._callout(
        "APRA alignment: These metrics directly evidence the retirement income covenant requirement to demonstrate member behaviour change over time. The multi-session refinement rate evidences that save2retire functions as an ongoing planning tool. The adviser referral rate demonstrates the platform's regulated triage function.",
        C.electric
      );
    }

    if (!latest) { this._bodyText("No data available."); return; }

    // Latest period snapshot
    const cW   = isDetailed ? 52 : 85;
    const cols = [
      { label: "Metric", width: 162 },
      ...cohorts.map(c => ({ label: COHORT_LABELS[c], width: cW, align: "right" })),
      ...(prev ? [{ label: "Change", width: 58, align: "right" }] : []),
    ];
    const rows = metrics.map(m => {
      const cells = [{ label: m.label, bold: true }];
      cohorts.forEach(c => cells.push({ label: fmtValue(this._snap(latest,c,m.key)?.metric_value, m.unit), align:"right" }));
      if (prev) {
        const cur  = this._snap(latest,"ALL",m.key)?.metric_value;
        const prv  = this._snap(prev,  "ALL",m.key)?.metric_value;
        const d    = fmtDelta(cur != null && prv != null ? cur - prv : null, m.unit);
        const dc   = deltaColor(d.direction, m.goodDir ?? "up");
        cells.push({ label: d.label, color: dc, arrow: d.direction, align:"right" });
      }
      return cells;
    });
    this._table(cols, rows, { rowH: 22, title: `Latest Period: ${fmtPeriod(latest)}` });

    // Trend table — all periods, ALL cohort
    if (periods.length > 1) {
      const tCols = [
        { label:"Metric", width:162 },
        ...periods.map(p => ({ label: fmtPeriod(p.period_label), width:55, align:"right" })),
      ];
      const tRows = metrics.map(m => {
        const cells = [{ label: m.label, bold:true }];
        periods.forEach(p => cells.push({ label: fmtValue(this._snap(p.period_label,"ALL",m.key)?.metric_value, m.unit), align:"right" }));
        return cells;
      });
      this._table(tCols, tRows, { rowH:22, title:'Trend — All Members' });
    }
  }

  // ── AI TOPICS ─────────────────────────────────────────────────────────────
  _buildTopicsSection() {
    const periods    = this.data.periods ?? [];
    const latest     = periods[periods.length - 1]?.period_label;
    const isDetailed = this.config.detail_level !== "summary";

    this._sectionHeading(
      "AI Topic Intelligence",
      "What members are asking about — classified at population scale, no individual question text stored"
    );

    this._callout(
      "Privacy: Individual question text is never stored. Each question is classified into one of 12 topic categories. Only the classification and cohort-level aggregates are retained in Beacon.",
      C.warning
    );

    if (!latest || !this.data.heatmap?.length) { this._bodyText("No topic data available."); return; }

    const cohorts = isDetailed ? ["ALL","C1","C2","C3","C4","C5"] : ["ALL","C1","C3","C5"];
    const cols = [
      { label:"Topic", width:195 },
      ...cohorts.map(c => ({ label: COHORT_LABELS[c], width: 50, align:"right" })),
    ];
    const rows = this.data.heatmap.map(row => [
      { label: `${row.topic}  ${PDF_TOPIC_LABELS[row.topic] ?? row.topic}` },
      ...cohorts.map(c => ({ label: row[c] != null ? fmtPct(row[c]) : "—", align:"right" })),
    ]);
    this._table(cols, rows, { headerBg: C.electricDim, rowH: 20, title: `Topic Distribution by Cohort — ${fmtPeriod(latest)}` });

    this._subHeading("Insight: Anxiety to Optimisation Shift");
    this._bodyText(
      "Topic T04 (market risk and longevity anxiety) represents reactive, fear-driven engagement. Topics T01 (salary sacrifice), T06 (drawdown strategies), and T07 (tax strategies) represent proactive, optimisation-driven engagement. A declining T04 share alongside growth in T01+T06+T07 is a leading indicator of improving member retirement confidence."
    );
  }

  // ── METHODOLOGY ───────────────────────────────────────────────────────────
  _buildMethodology() {
    this._sectionHeading("Methodology Appendix", "Metric definitions, cohort boundaries, anonymisation, and APRA alignment");

    this._table(
      [{ label:"Cohort",width:50 },{ label:"Age Band",width:62 },{ label:"Description",width:371 }],
      [
        [{ label:"C1",bold:true },{ label:"18-35" },{ label:"Early accumulation — building super balance and financial habits" }],
        [{ label:"C2",bold:true },{ label:"36-50" },{ label:"Mid-career — peak earning years, family and property commitments" }],
        [{ label:"C3",bold:true },{ label:"51-62" },{ label:"Pre-retirement — active planning, catch-up contributions, drawdown modelling" }],
        [{ label:"C4",bold:true },{ label:"63-67" },{ label:"Transition — approaching preservation age, retirement timing decisions" }],
        [{ label:"C5",bold:true },{ label:"68+"   },{ label:"In retirement — drawdown, Age Pension interaction, estate planning" }],
      ],
      { rowH:22, title:'Cohort Definitions' }
    );

    this._table(
      [{ label:"Metric",width:152 },{ label:"Definition",width:331 }],
      [
        [{ label:"Active Users",              bold:true },{ label:"Distinct members logging in at least once in the period" }],
        [{ label:"AI Tool Usage Rate",        bold:true },{ label:"% of active users engaging with the AI information tool at least once" }],
        [{ label:"Goal Declaration Rate",     bold:true },{ label:"% of active users with at least one financial goal declared" }],
        [{ label:"Projection Gap Rate",       bold:true },{ label:"% of active users whose base-case projection shows a funded shortfall" }],
        [{ label:"Salary Sacrifice Modelling",bold:true },{ label:"% of active users who have modelled salary sacrifice above $0" }],
        [{ label:"Return Visit Rate",         bold:true },{ label:"% of active users who logged in more than once in the period" }],
        [{ label:"Drawdown Strategy Modelling",bold:true},{ label:"% of active users who modelled an income sequencing or drawdown strategy" }],
        [{ label:"Multi-Session Refinement",  bold:true },{ label:"% of users who updated their plan across multiple separate sessions" }],
        [{ label:"Consolidation Signal",      bold:true },{ label:"% of users with indicators of multiple super fund accounts" }],
        [{ label:"Adviser Referral Trigger",  bold:true },{ label:"% of AI sessions where the compliance pipeline triggered an adviser referral" }],
      ],
      { rowH:20, title:'Metric Definitions' }
    );

    this._subHeading("Anonymisation and Privacy");
    this._bodyText(
      "Beacon does not store, transmit, or display any personally identifiable information. All metrics are computed at cohort level and subject to a minimum population threshold (default: 500 members). Cells below threshold are suppressed. The save2retire platform accesses Beacon only through named, read-only database views that strip all PII before any data crosses the system boundary."
    );

    this._subHeading("APRA Alignment");
    this._callout(
      "This report provides direct evidence against APRA Retirement Income Covenant requirements under SIS Act s.52(8). The behavioural change section addresses the 2025 Pulse Check finding that only 28% of funds measure engagement against specific cohorts and 21% have no measures at all.",
      C.electric
    );

    this._bodyText(
      "Data source: save2retire member planning platform. Aggregation: nightly classification pipeline. Generated: " +
      new Date().toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) + "."
    );
  }

  // ── Data access ───────────────────────────────────────────────────────────
  _snap(period, cohort, metric) {
    return this.data.snapshotMap?.[`${period}|${cohort}|${metric}`] ?? null;
  }
}

module.exports = BeaconPDFGenerator;
