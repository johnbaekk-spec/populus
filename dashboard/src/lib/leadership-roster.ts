/* signals-v4 M3 (R22, LD17): the congressional leadership roster the
   "Leadership trade" playbook reads (`playbooks.ts`).

   The posts are the twelve of Wei & Zhou (2025), NBER Working Paper 34524,
   Table A1 (from CRS): the Speaker; the House Democratic and Republican floor
   leaders, whips, Democratic Caucus chair and Republican Conference chair; the
   Senate Democratic floor leader (who chairs the caucus), the Republican floor
   leader, both whips and the Republican Conference chair.

   Every tenure that overlaps `ROSTER_FROM` onward is a row, each checked on
   `checked` against its primary source — history.house.gov and
   house.gov/leadership for the House, senate.gov for the Senate — whose URL is
   `source`. The official lists give exact dates only for the Speakers; the
   other posts are listed by Congress (House, Senate floor leaders) or by year
   (Senate whips and conference chairs). Such a tenure starts or ends on the
   first day of a Congress (2023-01-03, the 118th; 2025-01-03, the 119th), and
   `precision` says so. A tenure that began before `ROSTER_FROM` starts at it
   here, with the year the source gives in `since` — no earlier trade is ever
   classified, so no earlier date is asserted.

   A tenure is the half-open interval [from, to): a trade on `from` is inside
   it, a trade on `to` is not; `to` null is a tenure current on `checked`.

   Hand-maintained (debt TD-1): re-verify at every leadership change; the next
   is due by 2027-01-03, the 120th Congress. Pure, build memory only. */

/** Bumped whenever a row is added, removed or re-dated. */
export const ROSTER_VERSION = 1;
/** The first day the roster covers: a trade dated before it is never
    classified as a leadership trade. */
export const ROSTER_FROM = "2023-01-03";
/** When every row below was checked against its source. */
export const ROSTER_CHECKED = "2026-10-18";
/** The study the posts come from. */
export const ROSTER_STUDY = "Wei & Zhou (2025), NBER Working Paper 34524, Table A1";

export type LeadershipPostId =
  | "speaker"
  | "house-dem-leader"
  | "house-rep-leader"
  | "house-dem-whip"
  | "house-rep-whip"
  | "house-dem-caucus-chair"
  | "house-rep-conference-chair"
  | "senate-dem-leader"
  | "senate-rep-leader"
  | "senate-dem-whip"
  | "senate-rep-whip"
  | "senate-rep-conference-chair";

export interface LeadershipPost {
  id: LeadershipPostId;
  chamber: "house" | "senate";
  /** the post as the roster names it */
  name: string;
}

/** Wei & Zhou Table A1's twelve posts, in its order. */
export const LEADERSHIP_POSTS: readonly LeadershipPost[] = [
  { id: "speaker", chamber: "house", name: "Speaker of the House" },
  { id: "house-dem-leader", chamber: "house", name: "House Democratic floor leader" },
  { id: "house-rep-leader", chamber: "house", name: "House Republican floor leader" },
  { id: "house-dem-whip", chamber: "house", name: "House Democratic whip" },
  { id: "house-rep-whip", chamber: "house", name: "House Republican whip" },
  { id: "house-dem-caucus-chair", chamber: "house", name: "House Democratic Caucus chair" },
  { id: "house-rep-conference-chair", chamber: "house", name: "House Republican Conference chair" },
  { id: "senate-dem-leader", chamber: "senate", name: "Senate Democratic floor leader and caucus chair" },
  { id: "senate-rep-leader", chamber: "senate", name: "Senate Republican floor leader" },
  { id: "senate-dem-whip", chamber: "senate", name: "Senate Democratic whip" },
  { id: "senate-rep-whip", chamber: "senate", name: "Senate Republican whip" },
  { id: "senate-rep-conference-chair", chamber: "senate", name: "Senate Republican Conference chair" },
];

/** How finely the source dates a tenure: an exact day (the Speakers), a
    Congress, or a calendar year. */
export type TenurePrecision = "day" | "congress" | "year";

export interface RosterTenure {
  /** the member's congressional identifier (the build's `bioguide`) */
  bioguide: string;
  name: string;
  post: LeadershipPostId;
  /** what the member held, for the playbook's reason: "{name} {phrase} on the trade date" */
  phrase: string;
  /** inclusive, ISO date */
  from: string;
  /** exclusive, ISO date; null = current on `checked` */
  to: string | null;
  precision: TenurePrecision;
  /** the start the source gives, for a tenure that began before `ROSTER_FROM` */
  since: string | null;
  /** the dates as the source states them */
  sourceSays: string;
  /** the primary source, https */
  source: string;
  /** when the row was checked against `source` */
  checked: string;
}

const H = "https://history.house.gov/People/Office";
const S = "https://www.senate.gov/senators";

/** The roster: every tenure of the twelve posts from `ROSTER_FROM`. */
export const ROSTER: readonly RosterTenure[] = [
  {
    bioguide: "M001165", name: "Kevin McCarthy", post: "speaker", phrase: "was Speaker of the House",
    from: "2023-01-07", to: "2023-10-03", precision: "day", since: null,
    sourceSays: "elected Speaker on calendar day January 7, 2023; removed from the Speakership on October 3, 2023",
    source: `${H}/Speakers-List/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "J000299", name: "Mike Johnson", post: "speaker", phrase: "was Speaker of the House",
    from: "2023-10-25", to: null, precision: "day", since: null,
    sourceSays: "elected Speaker on October 25, 2023",
    source: `${H}/Speakers-List/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "J000294", name: "Hakeem Jeffries", post: "house-dem-leader", phrase: "was the House Democratic floor leader",
    from: "2023-01-03", to: null, precision: "congress", since: null,
    sourceSays: "118th Congress (2023–2025), 119th Congress (2025–2027)",
    source: `${H}/Minority-Leaders/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "S001176", name: "Steve Scalise", post: "house-rep-leader", phrase: "was the House Republican floor leader",
    from: "2023-01-03", to: null, precision: "congress", since: null,
    sourceSays: "118th Congress (2023–2025), 119th Congress (2025–2027)",
    source: `${H}/Majority-Leaders/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "C001101", name: "Katherine Clark", post: "house-dem-whip", phrase: "was the House Democratic whip",
    from: "2023-01-03", to: null, precision: "congress", since: null,
    sourceSays: "118th Congress (2023–2025), 119th Congress (2025–2027)",
    source: `${H}/Democratic-Whips/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "E000294", name: "Tom Emmer", post: "house-rep-whip", phrase: "was the House Republican whip",
    from: "2023-01-03", to: null, precision: "congress", since: null,
    sourceSays: "118th Congress (2023–2025), 119th Congress (2025–2027)",
    source: `${H}/Republican-Whips/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "A000371", name: "Pete Aguilar", post: "house-dem-caucus-chair", phrase: "chaired the House Democratic Caucus",
    from: "2023-01-03", to: null, precision: "congress", since: null,
    sourceSays: "118th Congress (2023–2025); chair in the 119th Congress on house.gov/leadership",
    source: `${H}/Democratic-Caucus-Chairs/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "S001196", name: "Elise Stefanik", post: "house-rep-conference-chair", phrase: "chaired the House Republican Conference",
    from: ROSTER_FROM, to: "2025-01-03", precision: "congress", since: "2021 (117th Congress)",
    sourceSays: "117th Congress (2021–2023, from mid-Congress), 118th Congress (2023–2025)",
    source: `${H}/Republican-Conference-Chairmen/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "M001136", name: "Lisa McClain", post: "house-rep-conference-chair", phrase: "chaired the House Republican Conference",
    from: "2025-01-03", to: null, precision: "congress", since: null,
    sourceSays: "119th Congress (2025–2027)",
    source: `${H}/Republican-Conference-Chairmen/`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "S000148", name: "Chuck Schumer", post: "senate-dem-leader", phrase: "was the Senate Democratic floor leader",
    from: ROSTER_FROM, to: null, precision: "congress", since: "2017 (115th Congress)",
    sourceSays: "Democratic floor leader, 115th–119th Congresses (2017–2027); \"Democratic Leader, Chair of the Conference\" on senate.gov/senators/leadership.htm",
    source: `${S}/majority-minority-leaders.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "M000355", name: "Mitch McConnell", post: "senate-rep-leader", phrase: "was the Senate Republican floor leader",
    from: ROSTER_FROM, to: "2025-01-03", precision: "congress", since: "2007 (110th Congress)",
    sourceSays: "Republican floor leader through the 118th Congress (2023–2025)",
    source: `${S}/majority-minority-leaders.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "T000250", name: "John Thune", post: "senate-rep-leader", phrase: "was the Senate Republican floor leader",
    from: "2025-01-03", to: null, precision: "congress", since: null,
    sourceSays: "Majority Leader, 119th Congress (2025–2027)",
    source: `${S}/majority-minority-leaders.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "D000563", name: "Dick Durbin", post: "senate-dem-whip", phrase: "was the Senate Democratic whip",
    from: ROSTER_FROM, to: null, precision: "year", since: "2005",
    sourceSays: "2005–present",
    source: `${S}/democratic-party-whips.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "T000250", name: "John Thune", post: "senate-rep-whip", phrase: "was the Senate Republican whip",
    from: ROSTER_FROM, to: "2025-01-03", precision: "year", since: "2019",
    sourceSays: "2019-2025",
    source: `${S}/republican-party-whips.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "B001261", name: "John Barrasso", post: "senate-rep-whip", phrase: "was the Senate Republican whip",
    from: "2025-01-03", to: null, precision: "year", since: null,
    sourceSays: "2025-present",
    source: `${S}/republican-party-whips.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "B001261", name: "John Barrasso", post: "senate-rep-conference-chair", phrase: "chaired the Senate Republican Conference",
    from: ROSTER_FROM, to: "2025-01-03", precision: "year", since: "2019",
    sourceSays: "2019–2025",
    source: `${S}/republican-conference-chairpersons.htm`, checked: ROSTER_CHECKED,
  },
  {
    bioguide: "C001095", name: "Tom Cotton", post: "senate-rep-conference-chair", phrase: "chaired the Senate Republican Conference",
    from: "2025-01-03", to: null, precision: "year", since: null,
    sourceSays: "2025–present; \"Republican Conference Chair\" on senate.gov/senators/leadership.htm",
    source: `${S}/republican-conference-chairpersons.htm`, checked: ROSTER_CHECKED,
  },
];

/** The post a member held on `traded`, or null: never for a trade before
    `ROSTER_FROM`, a trade with no date, or a member with no identifier. */
export function leadershipOn(
  bioguide: string | null,
  traded: string | null,
  roster: readonly RosterTenure[] = ROSTER,
): RosterTenure | null {
  if (!bioguide || !traded || traded < ROSTER_FROM) return null;
  return roster.find((r) => r.bioguide === bioguide && r.from <= traded && (r.to === null || traded < r.to)) ?? null;
}

/** "the Speakers by exact date, the other posts by Congress or year" — the
    precision statement every surface that cites the roster carries. */
export const ROSTER_PRECISION_TEXT =
  "The Speakers are dated to the day; the other posts by Congress or by year, as the official lists give them, starting or ending on the first day of a Congress (2023-01-03, 2025-01-03).";
