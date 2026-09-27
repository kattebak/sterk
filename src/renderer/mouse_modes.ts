/**
 * Mouse tracking mode (DEC 1000 / 1002 / 1003).
 *
 * Mutually exclusive — enabling one disables any other. See the DEC
 * private-mode handler in `terminal.ts` for the protocol wire-up.
 */
export enum MouseTrackingMode {
	/** No mouse tracking — wheel scrolls viewport. */
	Off = 0,
	/** DEC 1000 — VT200 tracking: press + release only, no motion. */
	VT200 = 1000,
	/** DEC 1002 — Cell-motion tracking: press + release + button-held drag. */
	CellMotion = 1002,
	/** DEC 1003 — All-motion tracking: every motion event, regardless of button. */
	AllMotion = 1003,
}

/**
 * Wire encoding for emitted mouse sequences (DEC 1006).
 *
 * Orthogonal to {@link MouseTrackingMode} — encoding controls *how* an
 * event is serialised, not *which* events are emitted.
 */
export enum MouseEncoding {
	/** Legacy X10 byte encoding (CSI M <Cb> <Cx> <Cy>). Default when 1006 is off. */
	Default = 0,
	/** DEC 1006 — SGR encoding (CSI < Cb ; Cx ; Cy M/m). */
	SGR = 1006,
}
