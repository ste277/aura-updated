'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS, SupportedMuhurthamActivityId, isSupportedMuhurthamActivity } from '../../../packages/recommendation/src/muhurthamFinder';
import type { MuhurthamDateCandidate, MuhurthamPersonalDateCandidate, MuhurthamPersonalSearchOutcome, MuhurthamSearchResult, MuhurthamSearchScope, MuhurthamSharedDateCandidate, MuhurthamSharedSearchOutcome, SharedMuhurthamRating } from '../../../packages/recommendation/src/muhurthamFinder';
import type { TimingCandidate, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import { saveUpcomingPlanFromCandidate } from './PlanWithAuraView';
import { ExploreModeToggle } from './ExploreModeToggle';
import { getDatePartsInTimezone, isValidIanaTimezone, searchTimezones, TimezoneOption } from '../lib/timezone';
import { CITY_OPTIONS, CityOption, formatCoordinateDirectional, isValidCustomLocation, parseCoordinate } from '../lib/cities';
import { RELATIONSHIP_ICON, RELATIONSHIP_LABEL, SavedPersonRow } from './PeopleView';
import { trackEvent } from '../lib/trackEvent';
import * as theme from './theme';
import { SegmentedControl } from './ui';

/** Event Location Search V1: the user's persistent everyday Timing
 * Location -- passed down as a full location object (not just a timezone
 * string) so this view can both display it as the default and, when the
 * user searches without an Event Location override, know exactly what was
 * used. Named `timingLocation`, never `currentLocation` (the app has no
 * GPS -- brief section 20) or `location` (ambiguous against Event
 * Location). */
export interface MuhurthamTimingLocation {
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface MuhurthamFinderViewProps {
  timingLocation: MuhurthamTimingLocation;
  onBack: () => void;
  onOpenPanchangCalendar: () => void;
  /** Jump the existing Panchang Calendar to a specific date (brief section
   * 14's "View full Panchang -> ") -- must reuse that same calendar/day-detail
   * implementation, never a second one. */
  onViewFullPanchang: (dateStr: string) => void;
  onPlanLogged?: () => void;
  /** Reuses the existing birth-profile setup screen (You -> Birth Chart) for
   * the "Complete profile" affordance in the incomplete-profile state --
   * brief section 11: "Reuse existing birth-profile setup/navigation. Do
   * not build another profile form." */
  onOpenBirthProfile: () => void;
  /** Reuses the existing People screen (You -> People) for both the "Us"
   * scope's empty state ("Add someone to find timings that work well for
   * both of you") and a SavedPerson with an incomplete profile -- Shared
   * Muhurtham brief section 13: "Reuse People screen. Do not create another
   * Add Person form inside Finder." */
  onOpenPeople: () => void;
  /** Explore's Quick Explore shortcuts (brief: "reuse existing occasion IDs
   * and selection logic... do not implement a second Muhurtham search
   * flow") -- mirrors PanchangCalendarView's own initialSelectedDate/
   * initialSelectedDateKey pattern exactly. Bump the key (e.g. Date.now())
   * alongside a new id to force re-selection even when it's the same id as
   * last time. */
  initialActivityId?: string;
  initialActivityIdKey?: number;
}

type RangePreset = 'THIS_MONTH' | 'NEXT_MONTH' | 'NEXT_3_MONTHS' | 'CUSTOM';

const RANGE_PRESET_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'NEXT_MONTH', label: 'Next month' },
  { value: 'NEXT_3_MONTHS', label: 'Next 3 months' },
  { value: 'CUSTOM', label: 'Choose dates' },
];

const TIME_PREFERENCE_OPTIONS: Array<{ value: TimingTimePreference; label: string; icon: string }> = [
  { value: 'ANY', label: 'Any time', icon: '✨' },
  { value: 'MORNING', label: 'Morning', icon: '🌅' },
  { value: 'AFTERNOON', label: 'Afternoon', icon: '☀️' },
  { value: 'EVENING', label: 'Evening', icon: '🌇' },
  { value: 'NIGHT', label: 'Night', icon: '🌙' },
];

const DURATION_OPTIONS_MINUTES = [30, 60, 90, 120];

const RATING_TEXT: Record<MuhurthamDateCandidate['rating'], string> = {
  EXCELLENT: 'Excellent',
  STRONG: 'Strong',
  FAVORABLE: 'Favorable',
  ACCEPTABLE: 'Acceptable',
};

const RATING_COLOR: Record<MuhurthamDateCandidate['rating'], string> = {
  EXCELLENT: theme.colors.positive,
  STRONG: theme.colors.positive,
  FAVORABLE: theme.colors.info,
  ACCEPTABLE: theme.colors.textMuted,
};

const SHARED_RATING_TEXT: Record<SharedMuhurthamRating, string> = {
  EXCELLENT_SHARED_FIT: 'Excellent shared fit',
  STRONG_SHARED_FIT: 'Strong shared fit',
  GOOD_SHARED_FIT: 'Good shared fit',
  MIXED_SHARED_FIT: 'Mixed fit',
};

const SHARED_RATING_COLOR: Record<SharedMuhurthamRating, string> = {
  EXCELLENT_SHARED_FIT: theme.colors.positive,
  STRONG_SHARED_FIT: theme.colors.positive,
  GOOD_SHARED_FIT: theme.colors.info,
  MIXED_SHARED_FIT: theme.colors.caution,
};

const DEFAULT_DISPLAY_COUNT = 5;
const SEARCH_LIMIT = 10;
const MAX_RANGE_DAYS = 180;
const EXPAND_STEP_DAYS = 30;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function daySpan(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
}

function endOfMonth(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(lastDay)}`;
}

/** Pure range computation for the "When?" presets (brief section 12) --
 * exported for unit testing without rendering the component. Returns null
 * only for CUSTOM when the user hasn't picked a valid start/end yet. */
export function computePresetRange(preset: RangePreset, todayDateStr: string, customStart: string, customEnd: string): { start: string; end: string } | null {
  const [y, m] = todayDateStr.split('-').map(Number);
  if (preset === 'THIS_MONTH') return { start: todayDateStr, end: endOfMonth(y, m) };
  if (preset === 'NEXT_MONTH') {
    const nextYear = m === 12 ? y + 1 : y;
    const nextMonth = m === 12 ? 1 : m + 1;
    return { start: `${String(nextYear).padStart(4, '0')}-${pad2(nextMonth)}-01`, end: endOfMonth(nextYear, nextMonth) };
  }
  if (preset === 'NEXT_3_MONTHS') return { start: todayDateStr, end: addDaysToDateStr(todayDateStr, 89) };
  if (customStart && customEnd && customEnd >= customStart) return { start: customStart, end: customEnd };
  return null;
}

/** Section 15's "strongly favorable" filter: ACCEPTABLE-rated dates are
 * withheld from the default results list (never manufactured as if they
 * were strong) and only revealed via the explicit "Show acceptable
 * options" action. Exported for unit testing. */
export function partitionDatesByStrength<T extends { rating: MuhurthamDateCandidate['rating'] }>(dates: T[]): { strong: T[]; acceptable: T[] } {
  return {
    strong: dates.filter((d) => d.rating !== 'ACCEPTABLE'),
    acceptable: dates.filter((d) => d.rating === 'ACCEPTABLE'),
  };
}

/** SHARED's counterpart to partitionDatesByStrength() above -- MIXED_SHARED_FIT
 * (at least one participant's own Tara Bala is a CAUTION for this candidate,
 * brief section 16) plays the same "withheld by default" role ACCEPTABLE
 * plays for GENERAL/PERSONAL, revealed via the same "Show ... options"
 * action. Exported for unit testing. */
export function partitionSharedDatesByStrength(dates: MuhurthamSharedDateCandidate[]): { strong: MuhurthamSharedDateCandidate[]; mixed: MuhurthamSharedDateCandidate[] } {
  return {
    strong: dates.filter((d) => d.rating !== 'MIXED_SHARED_FIT'),
    mixed: dates.filter((d) => d.rating === 'MIXED_SHARED_FIT'),
  };
}

export function formatDateLabel(dateStr: string, timezone: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const approxNoonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return approxNoonUTC.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' });
}

function formatClockTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

export function MuhurthamFinderView({ timingLocation, onBack, onOpenPanchangCalendar, onViewFullPanchang, onPlanLogged, onOpenBirthProfile, onOpenPeople, initialActivityId, initialActivityIdKey }: MuhurthamFinderViewProps) {
  // Event Location Search V1: `eventLocation` is the CURRENT picker
  // selection (null = "use my Timing Location") -- it only ever affects the
  // NEXT search. `resultEventLocation` is a SNAPSHOT of whatever
  // eventLocation was active at the moment the currently-displayed result
  // set was successfully returned -- every date/time formatting call below
  // reads from this snapshot, never from the live `eventLocation` picker
  // state, specifically so that changing the picker after a search does NOT
  // relabel already-displayed results (brief section 23: "Displayed
  // timezone/location must describe the search that ACTUALLY produced the
  // results, not merely current picker state").
  const [eventLocation, setEventLocation] = useState<CityOption | null>(null);
  const [resultEventLocation, setResultEventLocation] = useState<CityOption | null>(null);
  const [showEventLocationPicker, setShowEventLocationPicker] = useState(false);

  /** The location that actually produced whatever is currently displayed
   * (or, before any search, what a search would currently use) -- falls
   * back to the Timing Location exactly when no Event Location override is
   * active, which is also the byte-equivalence case (brief section 2). */
  const displayLocation: MuhurthamTimingLocation = resultEventLocation ?? timingLocation;
  const displayTimezone = displayLocation.timezone;
  /** Event Location Plan Persistence V1 enabled Save unconditionally
   * (PlannedActivity persists an Event Location snapshot). Event Location
   * AuraMoment Persistence V1 does the same for Share: AuraMoment now also
   * persists a correct snapshot (timezone/locationName, see
   * handleShareMoment below), so a custom Event Location result no longer
   * needs to be blocked from sharing either. Kept as two separate flags
   * (rather than collapsing back to one) since Save and Share still go
   * through genuinely different persistence paths that could, in
   * principle, regress independently. */
  const saveDisabled = false;
  const shareDisabled = false;

  /** The location the NEXT search will actually use -- the live picker
   * selection, never the stale result snapshot above. Drives the date
   * picker's own "today" reference and the request body. */
  const searchLocation: MuhurthamTimingLocation = eventLocation ?? timingLocation;

  const todayDateStr = useMemo(() => getDatePartsInTimezone(searchLocation.timezone, new Date()).dateStr, [searchLocation.timezone]);

  const [activityId, setActivityId] = useState<SupportedMuhurthamActivityId>('start-journey');
  const [rangePreset, setRangePreset] = useState<RangePreset>('NEXT_MONTH');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [timePreference, setTimePreference] = useState<TimingTimePreference>('ANY');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [scope, setScope] = useState<MuhurthamSearchScope>('GENERAL');

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MuhurthamSearchResult | null>(null);
  const [personalOutcome, setPersonalOutcome] = useState<MuhurthamPersonalSearchOutcome | null>(null);
  const [sharedOutcome, setSharedOutcome] = useState<MuhurthamSharedSearchOutcome | null>(null);
  const [activeRange, setActiveRange] = useState<{ start: string; end: string } | null>(null);

  const [showAllDates, setShowAllDates] = useState(false);
  const [showAcceptable, setShowAcceptable] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [savingWindowKey, setSavingWindowKey] = useState<string | null>(null);
  const [savedWindowKeys, setSavedWindowKeys] = useState<Set<string>>(new Set());
  const [sharingWindowKey, setSharingWindowKey] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<{ key: string; text: string } | null>(null);

  // SHARED's person selector -- lazily fetched (brief section 12: GENERAL/
  // PERSONAL never touch this) the first time the "Us" scope is opened, not
  // on mount, since GENERAL is the default and most searches never need it.
  const [savedPeople, setSavedPeople] = useState<SavedPersonRow[] | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');

  // Explore's Quick Explore shortcuts -- same pattern as
  // PanchangCalendarView's own initialSelectedDate/Key effect. Only ever
  // accepts a genuinely supported id (defensive; Explore only ever sends
  // one of these), and clears any stale search results from a previous
  // occasion so the owner doesn't see an old result set for a new pick.
  useEffect(() => {
    if (!initialActivityId) return;
    if (!isSupportedMuhurthamActivity(initialActivityId)) return;
    setActivityId(initialActivityId);
    setResult(null);
    setPersonalOutcome(null);
    setSharedOutcome(null);
    setResultEventLocation(null);
    setActiveRange(null);
    setShowAllDates(false);
    setShowAcceptable(false);
    setExpandedDate(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialActivityIdKey]);

  useEffect(() => {
    if (scope !== 'SHARED' || savedPeople !== null || loadingPeople) return;
    setLoadingPeople(true);
    fetch('/api/people')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Unable to load people.'))))
      .then((data: SavedPersonRow[]) => {
        setSavedPeople(data);
        if (data.length > 0) setSelectedPersonId((current) => current || data[0].id);
      })
      .catch(() => setSavedPeople([]))
      .finally(() => setLoadingPeople(false));
  }, [scope, savedPeople, loadingPeople]);

  const requestedRange = computePresetRange(rangePreset, todayDateStr, customStart, customEnd);
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId);
  const selectedPerson = savedPeople?.find((p) => p.id === selectedPersonId) ?? null;

  const runSearch = async (range: { start: string; end: string }, preference: TimingTimePreference, searchScope: MuhurthamSearchScope) => {
    setSearching(true);
    setError('');
    setShowAllDates(false);
    setShowAcceptable(false);
    setExpandedDate(null);
    trackEvent('MUHURTHAM_SEARCH_STARTED', { metadata: { scope: searchScope, activityId } });
    // Event Location Search V1: capture the picker's CURRENT selection at
    // the moment the search is fired -- this is what actually gets sent and
    // (on success) snapshotted as resultEventLocation, so a picker change
    // made WHILE this request is in flight can never relabel it.
    const requestEventLocation = eventLocation;
    try {
      const res = await fetch('/api/muhurtham-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          dateRange: range,
          timePreference: preference,
          durationMinutes,
          limit: SEARCH_LIMIT,
          scope: searchScope,
          savedPersonId: searchScope === 'SHARED' ? selectedPersonId : undefined,
          // Omitted entirely when using the Timing Location (brief section
          // 19: "prefer omitting eventLocation entirely from the request"),
          // for the clearest possible backward-compatible path -- an absent
          // key, not an explicit null/undefined value.
          ...(requestEventLocation ? { eventLocation: requestEventLocation } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to search for favorable dates.');
      if (searchScope === 'SHARED') {
        setSharedOutcome(data as MuhurthamSharedSearchOutcome);
        setResult(null);
        setPersonalOutcome(null);
      } else if (searchScope === 'PERSONAL') {
        setPersonalOutcome(data as MuhurthamPersonalSearchOutcome);
        setResult(null);
        setSharedOutcome(null);
      } else {
        setResult(data as MuhurthamSearchResult);
        setPersonalOutcome(null);
        setSharedOutcome(null);
      }
      setResultEventLocation(requestEventLocation);
      setActiveRange(range);
    } catch (err) {
      setResult(null);
      setPersonalOutcome(null);
      setSharedOutcome(null);
      setResultEventLocation(null);
      setActiveRange(null);
      setError(err instanceof Error ? err.message : 'Unable to search for favorable dates.');
    } finally {
      setSearching(false);
    }
  };

  const handleFindDates = () => {
    if (!requestedRange) {
      setError('Choose a start and end date.');
      return;
    }
    if (scope === 'SHARED' && !selectedPersonId) {
      setError('Choose a person to plan with.');
      return;
    }
    runSearch(requestedRange, timePreference, scope);
  };

  const handleExpandRange = () => {
    if (!activeRange) return;
    const span = daySpan(activeRange.start, activeRange.end);
    if (span >= MAX_RANGE_DAYS) return;
    const nextEnd = addDaysToDateStr(activeRange.end, Math.min(EXPAND_STEP_DAYS, MAX_RANGE_DAYS - span));
    setRangePreset('CUSTOM');
    setCustomStart(activeRange.start);
    setCustomEnd(nextEnd);
    runSearch({ start: activeRange.start, end: nextEnd }, timePreference, scope);
  };

  const handleRelaxTimePreference = () => {
    if (!activeRange) return;
    setTimePreference('ANY');
    runSearch(activeRange, 'ANY', scope);
  };

  const handleScopeChange = (nextScope: MuhurthamSearchScope) => {
    setScope(nextScope);
    setResult(null);
    setPersonalOutcome(null);
    setSharedOutcome(null);
    setResultEventLocation(null);
    setActiveRange(null);
    setError('');
    trackEvent('MUHURTHAM_SCOPE_SELECTED', { metadata: { scope: nextScope } });
  };

  const { strong: strongDates, acceptable: acceptableDates } = useMemo(() => partitionDatesByStrength(result?.dates ?? []), [result]);
  const visibleDates = showAcceptable ? result?.dates ?? [] : strongDates;
  const displayedDates = showAllDates ? visibleDates : visibleDates.slice(0, DEFAULT_DISPLAY_COUNT);

  const personalOk = personalOutcome?.status === 'OK' ? personalOutcome : null;
  const { strong: personalStrong, acceptable: personalAcceptable } = useMemo(() => partitionDatesByStrength(personalOk?.dates ?? []), [personalOk]);
  const personalVisible = showAcceptable ? personalOk?.dates ?? [] : personalStrong;
  const personalDisplayed = showAllDates ? personalVisible : personalVisible.slice(0, DEFAULT_DISPLAY_COUNT);

  const sharedOk = sharedOutcome?.status === 'OK' ? sharedOutcome : null;
  const { strong: sharedStrong, mixed: sharedMixed } = useMemo(() => partitionSharedDatesByStrength(sharedOk?.dates ?? []), [sharedOk]);
  const sharedVisible = showAcceptable ? sharedOk?.dates ?? [] : sharedStrong;
  const sharedDisplayed = showAllDates ? sharedVisible : sharedVisible.slice(0, DEFAULT_DISPLAY_COUNT);

  const canExpandRange = activeRange ? daySpan(activeRange.start, activeRange.end) < MAX_RANGE_DAYS : false;

  const windowKey = (dateKey: string, window: TimingCandidate) => `${dateKey}-${window.start}-${window.end}`;

  const handleUseThisTime = async (dateKey: string, window: TimingCandidate, sharedWithName?: string) => {
    const key = windowKey(dateKey, window);
    setSavingWindowKey(key);
    try {
      // Event Location Plan Persistence V1: the snapshot that produced the
      // CURRENTLY DISPLAYED result set -- resultEventLocation, never the
      // live picker (brief section 5) -- trimmed to {cityName, timezone}
      // at this save boundary, never coordinates (brief section 7).
      // Undefined for an ordinary Timing Location result, exactly
      // preserving prior behavior for that case.
      const eventLocation = resultEventLocation ? { cityName: resultEventLocation.cityName, timezone: resultEventLocation.timezone } : undefined;
      // Planned Activity Canonical Identity Propagation V1 -- this view's
      // own `activityId` state is already a genuine SUPPORTED_MUHURTHAM_ACTIVITY_IDS
      // value (a subset of the same FULL_ACTIVITY_CATALOG namespace), never
      // re-derived here.
      await saveUpcomingPlanFromCandidate(window, durationMinutes, { sharedWithName, eventLocation, activityId });
      setSavedWindowKeys((prev) => new Set(prev).add(key));
      onPlanLogged?.();
    } catch {
      // Best-effort -- the user can retry; no destructive state to roll back.
    } finally {
      setSavingWindowKey(null);
    }
  };

  /** Aura Moment Sharing V1 -- creates a snapshot of the SELECTED candidate
   * (never re-runs search) via POST /api/aura-moments, then opens the
   * native share sheet when available (brief section 7: "open native share
   * UI when available... Use navigator.share() where supported"), falling
   * back to copying the link. Works for all three scopes (brief section 7:
   * "If implementation is clean, GENERAL/PERSONAL may also be shareable") --
   * the request shape is identical across scopes; only ratingLabel/
   * savedPersonId vary per caller. */
  const handleShareMoment = async (dateKey: string, window: TimingCandidate, scope: MuhurthamSearchScope, ratingLabel: string, savedPersonId?: string) => {
    const key = windowKey(dateKey, window);
    setSharingWindowKey(key);
    setShareFeedback(null);
    try {
      // Event Location AuraMoment Persistence V1: the exact same
      // resultEventLocation snapshot handleUseThisTime uses above (brief
      // section 6/20) -- never the live eventLocation picker state.
      // Undefined for an ordinary Timing Location result, so the request
      // omits eventLocation entirely and the route falls back to
      // user.timezone, exactly preserving prior behavior for that case.
      const eventLocation = resultEventLocation ? { cityName: resultEventLocation.cityName, timezone: resultEventLocation.timezone } : undefined;
      const res = await fetch('/api/aura-moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, source: 'MUHURTHAM', activityId, startAt: window.start, endAt: window.end, ratingLabel, savedPersonId, ...(eventLocation ? { eventLocation } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to share this moment.');
      const shareUrl: string = data.shareUrl;
      const shareTitle = `A moment from Aura — ${activity?.title ?? 'Timing'}`;
      const shareText = 'Aura found a good time — take a look.';

      // The moment already exists at this point (the POST above succeeded),
      // so any failure from here on is only about HOW to hand the link to
      // the user, not whether sharing worked -- fall back to just showing
      // the link itself rather than surfacing a raw browser exception (e.g.
      // clipboard writes can throw "Document is not focused" in some
      // embedding contexts).
      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
          setShareFeedback({ key, text: 'Shared!' });
          trackEvent('AURA_MOMENT_SHARE_INITIATED', { auraMomentId: data.id, metadata: { scope, method: 'native_share', planningMode: getActivityDefinition(activityId)?.experience.planningMode ?? 'EVERYDAY' } });
        } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl);
          setShareFeedback({ key, text: 'Link copied!' });
          trackEvent('AURA_MOMENT_SHARE_INITIATED', { auraMomentId: data.id, metadata: { scope, method: 'copy_link', planningMode: getActivityDefinition(activityId)?.experience.planningMode ?? 'EVERYDAY' } });
        } else {
          setShareFeedback({ key, text: shareUrl });
        }
      } catch (shareErr) {
        // navigator.share() throws AbortError when the user simply dismisses
        // the native sheet -- not a failure, nothing to show for that.
        if (shareErr instanceof Error && shareErr.name === 'AbortError') {
          setSharingWindowKey(null);
          return;
        }
        setShareFeedback({ key, text: shareUrl });
      }
    } catch (err) {
      setShareFeedback({ key, text: err instanceof Error ? err.message : 'Unable to share this moment.' });
    } finally {
      setSharingWindowKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="Back to Explore" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          Explore
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Muhurtham Finder</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Favorable dates and windows for an occasion, from your existing Muhurta rules.</p>
        </div>
      </div>

      <ExploreModeToggle active="muhurtham" onSelectCalendar={onOpenPanchangCalendar} />

      <div>
        <div style={{ ...sectionKickerStyle, marginBottom: 8 }}>For</div>
        <SegmentedControl
          options={[
            { value: 'GENERAL' as const, label: <>🌐 General</> },
            { value: 'PERSONAL' as const, label: <>✨ Me</> },
            { value: 'SHARED' as const, label: <>❤️ Us</> },
          ]}
          value={scope}
          onChange={handleScopeChange}
        />
      </div>

      {scope === 'SHARED' && (
        <section style={cardStyle}>
          <div style={sectionKickerStyle}>For us</div>
          {loadingPeople && savedPeople === null ? (
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Loading your people…</p>
          ) : savedPeople && savedPeople.length === 0 ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 10 }}>Plan together</div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                Add someone to find timings that work well for both of you.
              </p>
              <button type="button" onClick={onOpenPeople} style={{ ...secondaryButtonStyle, marginTop: 12, textAlign: 'center' }}>
                Add person →
              </button>
            </>
          ) : savedPeople && savedPeople.length > 0 ? (
            <select value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)} style={{ ...selectStyle, marginTop: 10 }}>
              {savedPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {RELATIONSHIP_ICON[person.relationshipType]} {person.name} · {RELATIONSHIP_LABEL[person.relationshipType]}
                </option>
              ))}
            </select>
          ) : null}
        </section>
      )}

      <section style={cardStyle}>
        <div style={sectionKickerStyle}>What are you planning?</div>
        <select value={activityId} onChange={(e) => setActivityId(e.target.value as SupportedMuhurthamActivityId)} style={selectStyle}>
          {SUPPORTED_MUHURTHAM_ACTIVITY_IDS.map((id) => {
            const catalogEntry = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
            return (
              <option key={id} value={id}>
                {catalogEntry ? `${catalogEntry.icon} ${catalogEntry.title}` : id}
              </option>
            );
          })}
        </select>

        <div style={{ ...sectionKickerStyle, marginTop: 16 }}>When?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {RANGE_PRESET_OPTIONS.map((option) => (
            <PillButton key={option.value} label={option.label} active={rangePreset === option.value} onClick={() => setRangePreset(option.value)} />
          ))}
        </div>
        {rangePreset === 'CUSTOM' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <input type="date" value={customStart} min={todayDateStr} onChange={(e) => setCustomStart(e.target.value)} style={dateInputStyle} />
            <span style={{ color: '#64748b', fontSize: 12 }}>to</span>
            <input type="date" value={customEnd} min={customStart || todayDateStr} onChange={(e) => setCustomEnd(e.target.value)} style={dateInputStyle} />
          </div>
        )}

        <div style={{ ...sectionKickerStyle, marginTop: 16 }}>Preferred time (optional)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {TIME_PREFERENCE_OPTIONS.map((option) => (
            <PillButton key={option.value} label={`${option.icon} ${option.label}`} active={timePreference === option.value} onClick={() => setTimePreference(option.value)} />
          ))}
        </div>

        <div style={{ ...sectionKickerStyle, marginTop: 16 }}>Duration</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {DURATION_OPTIONS_MINUTES.map((minutes) => (
            <PillButton key={minutes} label={minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`} active={durationMinutes === minutes} onClick={() => setDurationMinutes(minutes)} />
          ))}
        </div>

        <div style={{ ...sectionKickerStyle, marginTop: 16 }}>Event location</div>
        {!showEventLocationPicker ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: '#dbe7f4' }}>
              {eventLocation ? eventLocation.cityName : <>Using your Timing Location: {timingLocation.cityName}</>}
            </span>
            <button type="button" onClick={() => setShowEventLocationPicker(true)} style={{ ...linkButtonStyle, fontSize: 12, flexShrink: 0 }}>
              {eventLocation ? 'Change' : 'Choose another location'}
            </button>
          </div>
        ) : (
          <EventLocationPicker
            timingLocation={timingLocation}
            initialLocation={eventLocation}
            onDone={(location) => {
              setEventLocation(location);
              setShowEventLocationPicker(false);
            }}
            onCancel={() => setShowEventLocationPicker(false)}
          />
        )}
        <p style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
          Used to calculate Panchang and Muhurtham timings for this event.
        </p>

        <button
          type="button"
          onClick={handleFindDates}
          disabled={searching || (scope === 'SHARED' && savedPeople?.length === 0)}
          style={{ ...primaryButtonStyle, marginTop: 18, opacity: searching || (scope === 'SHARED' && savedPeople?.length === 0) ? 0.7 : 1 }}
        >
          {searching ? 'Searching…' : 'Find Favorable Dates'}
        </button>
        {error && <div style={{ ...errorBoxStyle, marginTop: 10 }}>{error}</div>}
      </section>

      {scope === 'GENERAL' && result && (
        <>
          {resultEventLocation && <EventLocationResultBanner location={resultEventLocation} />}
          {visibleDates.length === 0 ? (
            <section style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>No strongly favorable dates were found in this range.</div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                {activity?.title ?? 'This activity'} didn&apos;t have a clearly favorable window between {formatDateLabel(result.dateRange.start, displayTimezone)} and {formatDateLabel(result.dateRange.end, displayTimezone)}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {canExpandRange && (
                  <button type="button" onClick={handleExpandRange} disabled={searching} style={secondaryButtonStyle}>
                    Expand search range (+{EXPAND_STEP_DAYS} days) →
                  </button>
                )}
                {timePreference !== 'ANY' && (
                  <button type="button" onClick={handleRelaxTimePreference} disabled={searching} style={secondaryButtonStyle}>
                    Relax preferred time →
                  </button>
                )}
                {acceptableDates.length > 0 && (
                  <button type="button" onClick={() => setShowAcceptable(true)} style={secondaryButtonStyle}>
                    Show acceptable options ({acceptableDates.length}) →
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              {displayedDates.map((date) => (
                <MuhurthamDateCard
                  key={date.date}
                  date={date}
                  timezone={displayTimezone}
                  expanded={expandedDate === date.date}
                  onToggleExpand={() => setExpandedDate((current) => (current === date.date ? null : date.date))}
                  onViewFullPanchang={() => onViewFullPanchang(date.date)}
                  onUseThisTime={(window) => handleUseThisTime(date.date, window)}
                  savingWindowKey={savingWindowKey}
                  savedWindowKeys={savedWindowKeys}
                  windowKey={windowKey}
                  onShareMoment={(window) => handleShareMoment(date.date, window, 'GENERAL', date.rating)}
                  sharingWindowKey={sharingWindowKey}
                  shareFeedback={shareFeedback}
                  saveDisabled={saveDisabled}
                  shareDisabled={shareDisabled}
                />
              ))}
              {!showAllDates && visibleDates.length > DEFAULT_DISPLAY_COUNT && (
                <button type="button" onClick={() => setShowAllDates(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  View more results ({visibleDates.length - DEFAULT_DISPLAY_COUNT} more) →
                </button>
              )}
              {!showAcceptable && acceptableDates.length > 0 && (
                <button type="button" onClick={() => setShowAcceptable(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  Show {acceptableDates.length} more acceptable option{acceptableDates.length === 1 ? '' : 's'} →
                </button>
              )}
            </>
          )}
        </>
      )}

      {scope === 'PERSONAL' && personalOutcome?.status === 'PERSONAL_PROFILE_INCOMPLETE' && (
        <section style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Personalize your Muhurtham</div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            Add your birth details to see timings matched to you.
          </p>
          <button type="button" onClick={onOpenBirthProfile} style={{ ...secondaryButtonStyle, marginTop: 12, textAlign: 'center' }}>
            Complete profile →
          </button>
        </section>
      )}

      {scope === 'PERSONAL' && personalOk && (
        <>
          {resultEventLocation && <EventLocationResultBanner location={resultEventLocation} />}
          {personalVisible.length === 0 ? (
            <section style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>No strongly favorable dates were found in this range.</div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                {activity?.title ?? 'This activity'} didn&apos;t have a clearly favorable window for you between {formatDateLabel(personalOk.dateRange.start, displayTimezone)} and {formatDateLabel(personalOk.dateRange.end, displayTimezone)}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {canExpandRange && (
                  <button type="button" onClick={handleExpandRange} disabled={searching} style={secondaryButtonStyle}>
                    Expand search range (+{EXPAND_STEP_DAYS} days) →
                  </button>
                )}
                {timePreference !== 'ANY' && (
                  <button type="button" onClick={handleRelaxTimePreference} disabled={searching} style={secondaryButtonStyle}>
                    Relax preferred time →
                  </button>
                )}
                {personalAcceptable.length > 0 && (
                  <button type="button" onClick={() => setShowAcceptable(true)} style={secondaryButtonStyle}>
                    Show acceptable options ({personalAcceptable.length}) →
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              {personalDisplayed.map((date, index) => (
                <MuhurthamPersonalDateCard
                  key={date.date}
                  date={date}
                  timezone={displayTimezone}
                  isBestForYou={index === 0}
                  expanded={expandedDate === date.date}
                  onToggleExpand={() => setExpandedDate((current) => (current === date.date ? null : date.date))}
                  onViewFullPanchang={() => onViewFullPanchang(date.date)}
                  onUseThisTime={(window) => handleUseThisTime(date.date, window)}
                  savingWindowKey={savingWindowKey}
                  savedWindowKeys={savedWindowKeys}
                  windowKey={windowKey}
                  onShareMoment={(window) => handleShareMoment(date.date, window, 'PERSONAL', date.rating)}
                  sharingWindowKey={sharingWindowKey}
                  shareFeedback={shareFeedback}
                  saveDisabled={saveDisabled}
                  shareDisabled={shareDisabled}
                />
              ))}
              {!showAllDates && personalVisible.length > DEFAULT_DISPLAY_COUNT && (
                <button type="button" onClick={() => setShowAllDates(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  View more results ({personalVisible.length - DEFAULT_DISPLAY_COUNT} more) →
                </button>
              )}
              {!showAcceptable && personalAcceptable.length > 0 && (
                <button type="button" onClick={() => setShowAcceptable(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  Show {personalAcceptable.length} more acceptable option{personalAcceptable.length === 1 ? '' : 's'} →
                </button>
              )}
            </>
          )}
        </>
      )}

      {scope === 'SHARED' && sharedOutcome?.status === 'USER_PROFILE_INCOMPLETE' && (
        <section style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Complete your own profile first</div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            Add your birth details so Aura can find timings that work well for both of you.
          </p>
          <button type="button" onClick={onOpenBirthProfile} style={{ ...secondaryButtonStyle, marginTop: 12, textAlign: 'center' }}>
            Complete profile →
          </button>
        </section>
      )}

      {scope === 'SHARED' && sharedOutcome?.status === 'SAVED_PERSON_PROFILE_INCOMPLETE' && (
        <section style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{selectedPerson ? `${selectedPerson.name}'s profile is incomplete` : "This person's profile is incomplete"}</div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            Add their birth details to find timings that work well for both of you.
          </p>
          <button type="button" onClick={onOpenPeople} style={{ ...secondaryButtonStyle, marginTop: 12, textAlign: 'center' }}>
            Edit person →
          </button>
        </section>
      )}

      {scope === 'SHARED' && sharedOk && (
        <>
          {resultEventLocation && <EventLocationResultBanner location={resultEventLocation} />}
          {sharedVisible.length === 0 ? (
            <section style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>No strongly favorable dates were found in this range.</div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                {activity?.title ?? 'This activity'} didn&apos;t have a clearly favorable window for both of you between {formatDateLabel(sharedOk.dateRange.start, displayTimezone)} and {formatDateLabel(sharedOk.dateRange.end, displayTimezone)}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {canExpandRange && (
                  <button type="button" onClick={handleExpandRange} disabled={searching} style={secondaryButtonStyle}>
                    Expand search range (+{EXPAND_STEP_DAYS} days) →
                  </button>
                )}
                {timePreference !== 'ANY' && (
                  <button type="button" onClick={handleRelaxTimePreference} disabled={searching} style={secondaryButtonStyle}>
                    Relax preferred time →
                  </button>
                )}
                {sharedMixed.length > 0 && (
                  <button type="button" onClick={() => setShowAcceptable(true)} style={secondaryButtonStyle}>
                    Show mixed-fit options ({sharedMixed.length}) →
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              {sharedDisplayed.map((date, index) => (
                <MuhurthamSharedDateCard
                  key={date.date}
                  date={date}
                  timezone={displayTimezone}
                  isBestForBoth={index === 0}
                  expanded={expandedDate === date.date}
                  onToggleExpand={() => setExpandedDate((current) => (current === date.date ? null : date.date))}
                  onViewFullPanchang={() => onViewFullPanchang(date.date)}
                  onUseThisTime={(window) => handleUseThisTime(date.date, window, date.person.name)}
                  savingWindowKey={savingWindowKey}
                  savedWindowKeys={savedWindowKeys}
                  windowKey={windowKey}
                  onShareMoment={(window) => handleShareMoment(date.date, window, 'SHARED', date.rating, date.person.savedPersonId)}
                  sharingWindowKey={sharingWindowKey}
                  shareFeedback={shareFeedback}
                  saveDisabled={saveDisabled}
                  shareDisabled={shareDisabled}
                />
              ))}
              {!showAllDates && sharedVisible.length > DEFAULT_DISPLAY_COUNT && (
                <button type="button" onClick={() => setShowAllDates(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  View more results ({sharedVisible.length - DEFAULT_DISPLAY_COUNT} more) →
                </button>
              )}
              {!showAcceptable && sharedMixed.length > 0 && (
                <button type="button" onClick={() => setShowAcceptable(true)} style={{ ...linkButtonStyle, alignSelf: 'center' }}>
                  Show {sharedMixed.length} more mixed-fit option{sharedMixed.length === 1 ? '' : 's'} →
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function MuhurthamDateCard({
  date,
  timezone,
  expanded,
  onToggleExpand,
  onViewFullPanchang,
  onUseThisTime,
  savingWindowKey,
  savedWindowKeys,
  windowKey,
  onShareMoment,
  sharingWindowKey,
  shareFeedback,
  saveDisabled,
  shareDisabled,
}: {
  date: MuhurthamDateCandidate;
  timezone: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onViewFullPanchang: () => void;
  onUseThisTime: (window: TimingCandidate) => void;
  savingWindowKey: string | null;
  savedWindowKeys: Set<string>;
  windowKey: (dateKey: string, window: TimingCandidate) => string;
  onShareMoment: (window: TimingCandidate) => void;
  sharingWindowKey: string | null;
  shareFeedback: { key: string; text: string } | null;
  saveDisabled: boolean;
  shareDisabled: boolean;
}) {
  const topReasons = date.reasons.slice(0, 3);
  const bestKey = windowKey(date.date, date.bestWindow);
  const bestSaved = savedWindowKeys.has(bestKey);
  const bestSaving = savingWindowKey === bestKey;

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{formatDateLabel(date.date, timezone)}</div>
          <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 3 }}>
            {formatClockTime(date.bestWindow.start, timezone)} – {formatClockTime(date.bestWindow.end, timezone)}
          </div>
        </div>
        <span style={{ ...ratingBadgeStyle, color: RATING_COLOR[date.rating], borderColor: RATING_COLOR[date.rating] }}>{RATING_TEXT[date.rating]}</span>
      </div>

      {topReasons.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          {topReasons.map((reason, i) => (
            <li key={i}>{formatMuhurtaReason(reason)}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onToggleExpand} style={linkButtonStyle}>
          {expanded ? 'Hide details' : 'View details'} {expanded ? '▲' : '▼'}
        </button>
        <button type="button" onClick={() => onUseThisTime(date.bestWindow)} disabled={bestSaving || bestSaved || saveDisabled} style={{ ...linkButtonStyle, color: bestSaved ? '#4ade80' : '#38bdf8' }}>
          {bestSaved ? 'Added to Plan ✓' : bestSaving ? 'Saving…' : 'Use this time →'}
        </button>
        <ShareMomentButton window={date.bestWindow} onShareMoment={onShareMoment} sharingWindowKey={sharingWindowKey} shareFeedback={shareFeedback} windowKeyValue={bestKey} disabled={shareDisabled} />
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={sectionKickerStyle}>Panchang</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <PanchangaMiniCell label="Tithi" value={date.panchangSummary.tithi} />
              <PanchangaMiniCell label="Nakshatra" value={date.panchangSummary.nakshatra} />
              <PanchangaMiniCell label="Yoga" value={date.panchangSummary.yoga} />
              <PanchangaMiniCell label="Karana" value={date.panchangSummary.karana} />
              <PanchangaMiniCell label="Vara" value={date.panchangSummary.vara} />
            </div>
          </div>

          {date.reasons.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#4ade80' }}>Why Aura selected it</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.reasons.map((reason, i) => (
                  <li key={i}>{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.cautions.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#facc15' }}>Considerations</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.cautions.map((reason, i) => (
                  <li key={i}>{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.alternateWindows.length > 0 && (
            <div>
              <div style={sectionKickerStyle}>Other good windows this date</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {date.alternateWindows.map((window) => {
                  const key = windowKey(date.date, window);
                  const saved = savedWindowKeys.has(key);
                  const saving = savingWindowKey === key;
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#dbe7f4' }}>{formatClockTime(window.start, timezone)} – {formatClockTime(window.end, timezone)}</span>
                      <button type="button" onClick={() => onUseThisTime(window)} disabled={saving || saved || saveDisabled} style={{ ...linkButtonStyle, fontSize: 12, color: saved ? '#4ade80' : '#38bdf8' }}>
                        {saved ? 'Added ✓' : saving ? 'Saving…' : 'Use this time →'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button type="button" onClick={onViewFullPanchang} style={{ ...linkButtonStyle, alignSelf: 'flex-start' }}>
            View full Panchang →
          </button>
        </div>
      )}
    </section>
  );
}

/** Display-only rating label for a standalone score (e.g. generalScore shown
 * inside a PERSONAL card) -- mirrors the domain's rateMuhurtham() thresholds
 * exactly (9.0/8.0/7.0), but without the caution-aware EXCELLENT cap since
 * this is a secondary informational label, not the card's own rating. */
function scoreRatingLabel(score: number): MuhurthamDateCandidate['rating'] {
  if (score >= 9.0) return 'EXCELLENT';
  if (score >= 8.0) return 'STRONG';
  if (score >= 7.0) return 'FAVORABLE';
  return 'ACCEPTABLE';
}

function MuhurthamPersonalDateCard({
  date,
  timezone,
  isBestForYou,
  expanded,
  onToggleExpand,
  onViewFullPanchang,
  onUseThisTime,
  savingWindowKey,
  savedWindowKeys,
  windowKey,
  onShareMoment,
  sharingWindowKey,
  shareFeedback,
  saveDisabled,
  shareDisabled,
}: {
  date: MuhurthamPersonalDateCandidate;
  timezone: string;
  isBestForYou: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onViewFullPanchang: () => void;
  onUseThisTime: (window: TimingCandidate) => void;
  savingWindowKey: string | null;
  savedWindowKeys: Set<string>;
  windowKey: (dateKey: string, window: TimingCandidate) => string;
  onShareMoment: (window: TimingCandidate) => void;
  sharingWindowKey: string | null;
  shareFeedback: { key: string; text: string } | null;
  saveDisabled: boolean;
  shareDisabled: boolean;
}) {
  const topReasons = date.reasons.slice(0, 3);
  const bestKey = windowKey(date.date, date.bestWindow);
  const bestSaved = savedWindowKeys.has(bestKey);
  const bestSaving = savingWindowKey === bestKey;
  const generalRating = scoreRatingLabel(date.generalScore);
  const taraBala = date.personalFactors.taraBala;

  return (
    <section style={cardStyle}>
      {isBestForYou && <div style={{ ...sectionKickerStyle, color: '#a78bfa', marginBottom: 8 }}>✨ Best for you</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{formatDateLabel(date.date, timezone)}</div>
          <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 3 }}>
            {formatClockTime(date.bestWindow.start, timezone)} – {formatClockTime(date.bestWindow.end, timezone)}
          </div>
        </div>
        <span style={{ ...ratingBadgeStyle, color: RATING_COLOR[date.rating], borderColor: RATING_COLOR[date.rating] }}>{RATING_TEXT[date.rating]} personal fit</span>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: '#94a3b8' }}>General Muhurta</span>
          <span style={{ fontWeight: 800, color: RATING_COLOR[generalRating] }}>{RATING_TEXT[generalRating]}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: '#94a3b8' }}>For you</span>
          <span style={{ fontWeight: 800, color: RATING_COLOR[date.rating] }}>{RATING_TEXT[date.rating]}</span>
        </div>
      </div>

      {topReasons.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          {topReasons.map((reason, i) => (
            <li key={i}>{reason.factor === 'PERSONAL' ? '✨ ' : ''}{formatMuhurtaReason(reason)}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onToggleExpand} style={linkButtonStyle}>
          {expanded ? 'Hide details' : 'Why this time?'} {expanded ? '▲' : '▼'}
        </button>
        <button type="button" onClick={() => onUseThisTime(date.bestWindow)} disabled={bestSaving || bestSaved || saveDisabled} style={{ ...linkButtonStyle, color: bestSaved ? '#4ade80' : '#38bdf8' }}>
          {bestSaved ? 'Added to Plan ✓' : bestSaving ? 'Saving…' : 'Use this time →'}
        </button>
        <ShareMomentButton window={date.bestWindow} onShareMoment={onShareMoment} sharingWindowKey={sharingWindowKey} shareFeedback={shareFeedback} windowKeyValue={bestKey} disabled={shareDisabled} />
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={sectionKickerStyle}>Panchang</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <PanchangaMiniCell label="Tithi" value={date.panchangSummary.tithi} />
              <PanchangaMiniCell label="Nakshatra" value={date.panchangSummary.nakshatra} />
              <PanchangaMiniCell label="Yoga" value={date.panchangSummary.yoga} />
              <PanchangaMiniCell label="Karana" value={date.panchangSummary.karana} />
              <PanchangaMiniCell label="Vara" value={date.panchangSummary.vara} />
            </div>
          </div>

          {taraBala && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#a78bfa' }}>Personalized for your birth Nakshatra</div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                ✨ {taraBala.tara} Tara — {taraBala.status === 'SUPPORT' ? 'personally supportive' : taraBala.status === 'CAUTION' ? 'a personal caution' : 'personally neutral'}
              </p>
            </div>
          )}

          {date.reasons.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#4ade80' }}>Why this suits you</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.reasons.map((reason, i) => (
                  <li key={i}>{reason.factor === 'PERSONAL' ? '✨ ' : '✓ '}{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.cautions.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#facc15' }}>Considerations</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.cautions.map((reason, i) => (
                  <li key={i}>{reason.factor === 'PERSONAL' ? '✨ ' : ''}{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.alternateWindows.length > 0 && (
            <div>
              <div style={sectionKickerStyle}>Other good windows this date</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {date.alternateWindows.map((window) => {
                  const key = windowKey(date.date, window);
                  const saved = savedWindowKeys.has(key);
                  const saving = savingWindowKey === key;
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#dbe7f4' }}>{formatClockTime(window.start, timezone)} – {formatClockTime(window.end, timezone)}</span>
                      <button type="button" onClick={() => onUseThisTime(window)} disabled={saving || saved || saveDisabled} style={{ ...linkButtonStyle, fontSize: 12, color: saved ? '#4ade80' : '#38bdf8' }}>
                        {saved ? 'Added ✓' : saving ? 'Saving…' : 'Use this time →'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button type="button" onClick={onViewFullPanchang} style={{ ...linkButtonStyle, alignSelf: 'flex-start' }}>
            View full Panchang →
          </button>
        </div>
      )}
    </section>
  );
}

/** Section 14's condensed 3-line summary, shown even when the card isn't
 * expanded: one line for the general Muhurta's own strength, one for
 * whether it's supportive/a caution for the user, one for the SavedPerson.
 * Deliberately short and non-numeric -- the full per-person reason lists
 * live in the expanded view below. */
function participantStatusLine(status: 'SUPPORT' | 'NEUTRAL' | 'CAUTION', label: string): string {
  if (status === 'SUPPORT') return `Supportive for ${label}`;
  if (status === 'CAUTION') return `A personal caution for ${label}`;
  return `Neutral for ${label}`;
}

function MuhurthamSharedDateCard({
  date,
  timezone,
  isBestForBoth,
  expanded,
  onToggleExpand,
  onViewFullPanchang,
  onUseThisTime,
  savingWindowKey,
  savedWindowKeys,
  windowKey,
  onShareMoment,
  sharingWindowKey,
  shareFeedback,
  saveDisabled,
  shareDisabled,
}: {
  date: MuhurthamSharedDateCandidate;
  timezone: string;
  isBestForBoth: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onViewFullPanchang: () => void;
  onUseThisTime: (window: TimingCandidate) => void;
  savingWindowKey: string | null;
  savedWindowKeys: Set<string>;
  windowKey: (dateKey: string, window: TimingCandidate) => string;
  onShareMoment: (window: TimingCandidate) => void;
  sharingWindowKey: string | null;
  shareFeedback: { key: string; text: string } | null;
  saveDisabled: boolean;
  shareDisabled: boolean;
}) {
  const bestKey = windowKey(date.date, date.bestWindow);
  const bestSaved = savedWindowKeys.has(bestKey);
  const bestSaving = savingWindowKey === bestKey;
  const generalRating = scoreRatingLabel(date.generalScore);
  const userRating = scoreRatingLabel(date.user.score);
  const personRating = scoreRatingLabel(date.person.score);
  const userTaraStatus = date.user.factors.taraBala?.status ?? 'NEUTRAL';
  const personTaraStatus = date.person.factors.taraBala?.status ?? 'NEUTRAL';

  return (
    <section style={cardStyle}>
      {isBestForBoth && <div style={{ ...sectionKickerStyle, color: '#fb7185', marginBottom: 8 }}>❤️ Best for both</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{formatDateLabel(date.date, timezone)}</div>
          <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 3 }}>
            {formatClockTime(date.bestWindow.start, timezone)} – {formatClockTime(date.bestWindow.end, timezone)}
          </div>
        </div>
        <span style={{ ...ratingBadgeStyle, color: SHARED_RATING_COLOR[date.rating], borderColor: SHARED_RATING_COLOR[date.rating] }}>{SHARED_RATING_TEXT[date.rating]}</span>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: '#94a3b8' }}>General Muhurta</span>
          <span style={{ fontWeight: 800, color: RATING_COLOR[generalRating] }}>{RATING_TEXT[generalRating]}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: '#94a3b8' }}>You</span>
          <span style={{ fontWeight: 800, color: RATING_COLOR[userRating] }}>{RATING_TEXT[userRating]}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: '#94a3b8' }}>{date.person.name}</span>
          <span style={{ fontWeight: 800, color: RATING_COLOR[personRating] }}>{RATING_TEXT[personRating]}</span>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ ...sectionKickerStyle, fontSize: 10 }}>Why this works for both</div>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          <li>{RATING_TEXT[generalRating]} general Muhurta</li>
          <li>✨ {participantStatusLine(userTaraStatus, 'you')}</li>
          <li>❤️ {participantStatusLine(personTaraStatus, date.person.name)}</li>
        </ul>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onToggleExpand} style={linkButtonStyle}>
          {expanded ? 'Hide details' : 'Why this time?'} {expanded ? '▲' : '▼'}
        </button>
        <button type="button" onClick={() => onUseThisTime(date.bestWindow)} disabled={bestSaving || bestSaved || saveDisabled} style={{ ...linkButtonStyle, color: bestSaved ? '#4ade80' : '#38bdf8' }}>
          {bestSaved ? 'Added to Plan ✓' : bestSaving ? 'Saving…' : 'Use this time →'}
        </button>
        <ShareMomentButton window={date.bestWindow} onShareMoment={onShareMoment} sharingWindowKey={sharingWindowKey} shareFeedback={shareFeedback} windowKeyValue={bestKey} disabled={shareDisabled} />
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={sectionKickerStyle}>Panchang</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <PanchangaMiniCell label="Tithi" value={date.panchangSummary.tithi} />
              <PanchangaMiniCell label="Nakshatra" value={date.panchangSummary.nakshatra} />
              <PanchangaMiniCell label="Yoga" value={date.panchangSummary.yoga} />
              <PanchangaMiniCell label="Karana" value={date.panchangSummary.karana} />
              <PanchangaMiniCell label="Vara" value={date.panchangSummary.vara} />
            </div>
          </div>

          {date.reasons.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#4ade80' }}>General Muhurta</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.reasons.map((reason, i) => (
                  <li key={i}>{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.user.reasons.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#a78bfa' }}>For you</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.user.reasons.map((reason, i) => (
                  <li key={i}>{reason.polarity === 'SUPPORT' ? '✓ ' : '⚠ '}{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.person.reasons.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#fb7185' }}>For {date.person.name}</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.person.reasons.map((reason, i) => (
                  <li key={i}>{reason.polarity === 'SUPPORT' ? '✓ ' : '⚠ '}{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.cautions.length > 0 && (
            <div>
              <div style={{ ...sectionKickerStyle, color: '#facc15' }}>Considerations</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbe7f4', lineHeight: 1.6 }}>
                {date.cautions.map((reason, i) => (
                  <li key={i}>{formatMuhurtaReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          {date.alternateWindows.length > 0 && (
            <div>
              <div style={sectionKickerStyle}>Other good windows this date</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {date.alternateWindows.map((window) => {
                  const key = windowKey(date.date, window);
                  const saved = savedWindowKeys.has(key);
                  const saving = savingWindowKey === key;
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#dbe7f4' }}>{formatClockTime(window.start, timezone)} – {formatClockTime(window.end, timezone)}</span>
                      <button type="button" onClick={() => onUseThisTime(window)} disabled={saving || saved || saveDisabled} style={{ ...linkButtonStyle, fontSize: 12, color: saved ? '#4ade80' : '#38bdf8' }}>
                        {saved ? 'Added ✓' : saving ? 'Saving…' : 'Use this time →'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button type="button" onClick={onViewFullPanchang} style={{ ...linkButtonStyle, alignSelf: 'flex-start' }}>
            View full Panchang →
          </button>
        </div>
      )}
    </section>
  );
}

/** Shared by all three result card types (GENERAL/PERSONAL/SHARED) --
 * creates an Aura Moment snapshot of THIS window and opens the native share
 * sheet where supported, falling back to a copy-link confirmation. Never
 * disabled based on scope -- brief section 7: "If implementation is clean,
 * GENERAL/PERSONAL may also be shareable." */
function ShareMomentButton({
  window: shareWindow,
  onShareMoment,
  sharingWindowKey,
  shareFeedback,
  windowKeyValue,
  disabled,
}: {
  window: TimingCandidate;
  onShareMoment: (window: TimingCandidate) => void;
  sharingWindowKey: string | null;
  shareFeedback: { key: string; text: string } | null;
  windowKeyValue: string;
  disabled?: boolean;
}) {
  const sharing = sharingWindowKey === windowKeyValue;
  const feedback = shareFeedback?.key === windowKeyValue ? shareFeedback.text : null;
  return (
    <button type="button" onClick={() => onShareMoment(shareWindow)} disabled={sharing || disabled} style={{ ...linkButtonStyle, color: feedback ? '#4ade80' : '#38bdf8' }}>
      {feedback ?? (sharing ? 'Sharing…' : 'Share this moment')}
    </button>
  );
}

function PanchangaMiniCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={panchangaCellStyle}>
      <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'var(--as-font-mono)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/** Event Location Search V1's informational banner -- names the location
 * that actually produced the currently-displayed results (brief section
 * 22). Now purely descriptive: Event Location AuraMoment Persistence V1
 * removed the last reason Save/Share were ever disabled for a custom Event
 * Location result, so this no longer carries a "why disabled" explanation. */
function EventLocationResultBanner({ location }: { location: CityOption }) {
  return (
    <div style={{ ...cardStyle, padding: '10px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#dbe7f4' }}>
        📍 Event location: {location.cityName} ({formatCoordinateDirectional(location.latitude, 'lat')}, {formatCoordinateDirectional(location.longitude, 'lng')})
      </div>
    </div>
  );
}

/**
 * Event Location Search V1: a lightweight, self-contained location picker
 * for a ONE-TIME Muhurtham search override -- reuses the exact same
 * presentation/parsing/validation primitives Planning Location's own
 * LocationPicker (components/LocationPicker.tsx) uses (CITY_OPTIONS,
 * parseCoordinate, isValidCustomLocation, searchTimezones,
 * isValidIanaTimezone), but is NOT that component and never calls
 * PATCH /api/users/location -- selecting here only ever calls back to the
 * parent's own onDone(location), which stores the choice in local
 * component state (brief section 18: "Keep selected Event Location in
 * MuhurthamFinderView/client state... Do NOT persist it to User"). No
 * network request of any kind happens in this component.
 */
function EventLocationPicker({
  timingLocation,
  initialLocation,
  onDone,
  onCancel,
}: {
  timingLocation: MuhurthamTimingLocation;
  initialLocation: CityOption | null;
  onDone: (location: CityOption | null) => void;
  onCancel: () => void;
}) {
  const OTHER_VALUE = '__other__';
  const [mode, setMode] = useState<'select' | 'custom'>('select');
  const [custom, setCustom] = useState({ cityName: initialLocation?.cityName ?? '', latitude: '', longitude: '', timezone: '' });
  const [touched, setTouched] = useState(false);
  const [timezoneMenuOpen, setTimezoneMenuOpen] = useState(false);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === OTHER_VALUE) {
      setMode('custom');
      return;
    }
    const selected = CITY_OPTIONS.find((c) => c.cityName === value);
    if (selected) onDone(selected);
  };

  const parsedLatitude = useMemo(() => parseCoordinate(custom.latitude, 'lat'), [custom.latitude]);
  const parsedLongitude = useMemo(() => parseCoordinate(custom.longitude, 'lng'), [custom.longitude]);
  const timezoneValid = useMemo(() => isValidIanaTimezone(custom.timezone.trim()), [custom.timezone]);
  const timezoneSuggestions: TimezoneOption[] = useMemo(() => (custom.timezone.trim() ? searchTimezones(custom.timezone.trim()) : []), [custom.timezone]);
  const cityNameValid = custom.cityName.trim().length > 0;
  const formValid = cityNameValid && parsedLatitude !== null && parsedLongitude !== null && timezoneValid
    && isValidCustomLocation({ latitude: parsedLatitude, longitude: parsedLongitude, timezone: custom.timezone.trim() });

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid || parsedLatitude === null || parsedLongitude === null) return;
    onDone({ cityName: custom.cityName.trim(), latitude: parsedLatitude, longitude: parsedLongitude, timezone: custom.timezone.trim() });
  };

  if (mode === 'custom') {
    return (
      <form onSubmit={handleCustomSubmit} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="text" placeholder="City name" value={custom.cityName} onChange={(e) => setCustom((c) => ({ ...c, cityName: e.target.value }))} style={dateInputStyle} />
        {touched && !cityNameValid && <span style={{ fontSize: 11, color: '#f87171' }}>City name is required.</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="Latitude (e.g. 9.9312 N)" value={custom.latitude} onChange={(e) => setCustom((c) => ({ ...c, latitude: e.target.value }))} style={{ ...dateInputStyle, flex: 1 }} />
          <input type="text" placeholder="Longitude (e.g. 76.2673 E)" value={custom.longitude} onChange={(e) => setCustom((c) => ({ ...c, longitude: e.target.value }))} style={{ ...dateInputStyle, flex: 1 }} />
        </div>
        {touched && (parsedLatitude === null || parsedLongitude === null) && <span style={{ fontSize: 11, color: '#f87171' }}>Enter valid coordinates (e.g. 9.9312 or 9.9312 N).</span>}
        {touched && parsedLatitude !== null && parsedLongitude !== null && !isValidCustomLocation({ latitude: parsedLatitude, longitude: parsedLongitude, timezone: 'UTC' }) && (
          <span style={{ fontSize: 11, color: '#f87171' }}>Latitude must be between -66.5 and 66.5, longitude between -180 and 180.</span>
        )}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Timezone (e.g. Asia/Kolkata)"
            value={custom.timezone}
            onChange={(e) => setCustom((c) => ({ ...c, timezone: e.target.value }))}
            onFocus={() => setTimezoneMenuOpen(true)}
            onBlur={() => setTimeout(() => setTimezoneMenuOpen(false), 150)}
            style={dateInputStyle}
          />
          {timezoneMenuOpen && timezoneSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, marginTop: 4 }}>
              {timezoneSuggestions.map((tz) => (
                <button
                  key={tz.id}
                  type="button"
                  onClick={() => setCustom((c) => ({ ...c, timezone: tz.id }))}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', color: '#f8fafc', fontSize: 12, cursor: 'pointer' }}
                >
                  {tz.id} — {tz.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {touched && !timezoneValid && <span style={{ fontSize: 11, color: '#f87171' }}>Enter a valid timezone name (e.g. &quot;America/Chicago&quot;).</span>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" style={{ ...linkButtonStyle, color: '#4ade80' }}>Use this location</button>
          <button type="button" onClick={() => setMode('select')} style={linkButtonStyle}>Back</button>
        </div>
      </form>
    );
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select defaultValue="" onChange={handleSelectChange} style={selectStyle}>
        <option value="" disabled>
          Choose a city…
        </option>
        {CITY_OPTIONS.map((city) => (
          <option key={city.cityName} value={city.cityName}>
            {city.cityName}
          </option>
        ))}
        <option value={OTHER_VALUE}>Other (enter coordinates)…</option>
      </select>
      <div style={{ display: 'flex', gap: 12 }}>
        <button type="button" onClick={() => onDone(null)} style={{ ...linkButtonStyle, fontSize: 12 }}>
          Use Timing Location ({timingLocation.cityName})
        </button>
        <button type="button" onClick={onCancel} style={{ ...linkButtonStyle, fontSize: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PillButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...pillButtonStyle,
        background: active ? '#4ade80' : 'rgba(255, 255, 255, 0.06)',
        color: active ? '#020617' : '#f8fafc',
        border: active ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {label}
    </button>
  );
}

const cardStyle: React.CSSProperties = theme.panelStyle;
const backButtonStyle: React.CSSProperties = theme.backButtonStyle;
const sectionKickerStyle: React.CSSProperties = theme.sectionKickerStyle;

const selectStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 10,
  minHeight: 44,
  borderRadius: 10,
  border: '1px solid rgba(255, 255, 255, 0.12)',
  background: 'rgba(2, 6, 23, 0.5)',
  color: '#f8fafc',
  fontSize: 14,
  padding: '0 10px',
};

const dateInputStyle: React.CSSProperties = {
  minHeight: 38,
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, 0.12)',
  background: 'rgba(2, 6, 23, 0.5)',
  color: '#f8fafc',
  fontSize: 12,
  padding: '0 8px',
};

const pillButtonStyle: React.CSSProperties = {
  minHeight: 34,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 750,
  cursor: 'pointer',
  padding: '0 12px',
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 46,
  borderRadius: 14,
  border: 'none',
  background: '#4ade80',
  color: '#020617',
  fontSize: 14,
  fontWeight: 900,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = { ...theme.outlineButtonStyle, padding: '0 14px', textAlign: 'left' };

const linkButtonStyle: React.CSSProperties = theme.linkButtonStyle;

const errorBoxStyle: React.CSSProperties = theme.errorBoxStyle;

const ratingBadgeStyle: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 999,
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 850,
  flexShrink: 0,
};

const panchangaCellStyle: React.CSSProperties = theme.cellStyle;
