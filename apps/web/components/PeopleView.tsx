'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CITY_OPTIONS } from '../lib/cities';
import type { CityOption } from '../lib/cities';
import * as theme from './theme';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, DestructiveButton, EmptyState, FieldLabel, TextInput, SelectInput } from './ui';
import { isMyPeopleClientEffective, isMyPeoplePresentationEnabled, MY_PEOPLE_CAPABILITY_HEADER } from '../lib/myPeopleGate';

export type RelationshipType = 'PARTNER' | 'SPOUSE' | 'FAMILY' | 'FRIEND' | 'OTHER' | 'PARENT' | 'CHILD' | 'SIBLING';

export interface SavedPersonRow {
  id: string;
  name: string;
  relationshipType: RelationshipType;
  // AURA-MP-1: null for a person saved without birth details (all-or-none).
  // R1 F5: absent from the enabled list contract (present in legacy list and detail).
  birthDate?: string | null;
  birthTime?: string | null;
  birthTimezone?: string | null;
  birthCityName?: string | null;
  birthLatitude?: number | null;
  birthLongitude?: number | null;
  hasChartDetails?: boolean;
}

/** AURA-MP-1: true only when the person has complete birth (chart) details. */
export function personHasChartDetails(person: Partial<Pick<SavedPersonRow, 'birthDate' | 'birthTime' | 'birthTimezone' | 'hasChartDetails'>>): boolean {
  // R1 F5: the enabled list contract carries only hasChartDetails (no birth fields).
  if (typeof person.hasChartDetails === 'boolean') return person.hasChartDetails;
  return Boolean(person.birthDate && person.birthTime && person.birthTimezone);
}

/** R1 F2: what this screen may present -- the public flag AND the server's confirmation. */
function effectiveFromResponse(res: { headers?: { get(name: string): string | null } }): boolean {
  return isMyPeopleClientEffective(isMyPeoplePresentationEnabled(), res.headers?.get(MY_PEOPLE_CAPABILITY_HEADER) ?? null);
}

interface SavedPersonDetail extends SavedPersonRow {
  natalContext: { janmaNakshatra: string; janmaRashi: string; moonElement: string } | null;
}

interface PeopleViewProps {
  onBack: () => void;
}

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipType; label: string; icon: string; myPeopleOnly?: boolean }> = [
  { value: 'PARTNER', label: 'Partner', icon: '❤️' },
  { value: 'SPOUSE', label: 'Spouse', icon: '💍' },
  { value: 'FAMILY', label: 'Family', icon: '👪' },
  { value: 'FRIEND', label: 'Friend', icon: '🤝' },
  { value: 'OTHER', label: 'Other', icon: '👤' },
  // AURA-MP-1 (D2): offered only while My People is on, but ALWAYS labelled,
  // so a person saved with one of these renders correctly when it is off.
  { value: 'PARENT', label: 'Parent', icon: '👪', myPeopleOnly: true },
  { value: 'CHILD', label: 'Child', icon: '👪', myPeopleOnly: true },
  { value: 'SIBLING', label: 'Sibling', icon: '👪', myPeopleOnly: true },
];

/** Exported so other screens that reference a SavedPerson (e.g. Muhurtham
 * Finder's "Us" person selector) render the same relationship icon/label
 * vocabulary instead of re-declaring it -- there is exactly one
 * relationship-type -> icon/label mapping in this app. */
export const RELATIONSHIP_LABEL: Record<RelationshipType, string> = Object.fromEntries(RELATIONSHIP_OPTIONS.map((o) => [o.value, o.label])) as Record<RelationshipType, string>;
export const RELATIONSHIP_ICON: Record<RelationshipType, string> = Object.fromEntries(RELATIONSHIP_OPTIONS.map((o) => [o.value, o.icon])) as Record<RelationshipType, string>;

type ViewMode = { kind: 'LIST' } | { kind: 'ADD' } | { kind: 'DETAIL'; personId: string } | { kind: 'EDIT'; personId: string };

export function PeopleView({ onBack }: PeopleViewProps) {
  const [mode, setMode] = useState<ViewMode>({ kind: 'LIST' });
  const [people, setPeople] = useState<SavedPersonRow[] | null>(null);
  const [error, setError] = useState('');
  const [myPeopleEffective, setMyPeopleEffective] = useState(false);
  // R3: the SERVER's state decides which creations are valid (name-only is
  // valid only when the server has My People enabled); presentation only
  // decides which options are shown.
  const [serverEnabled, setServerEnabled] = useState(false);

  const loadPeople = async () => {
    setError('');
    try {
      const res = await fetch('/api/people');
      if (!res.ok) throw new Error('Unable to load people.');
      setMyPeopleEffective(effectiveFromResponse(res));
      setServerEnabled(res.headers?.get(MY_PEOPLE_CAPABILITY_HEADER) === 'enabled');
      setPeople(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load people.');
      setPeople([]);
    }
  };

  useEffect(() => {
    loadPeople();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button type="button" onClick={mode.kind === 'LIST' ? onBack : () => setMode({ kind: 'LIST' })} aria-label="Back" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          {mode.kind === 'LIST' ? 'You' : 'People'}
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>People</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>The people you plan with.</p>
        </div>
      </div>

      {mode.kind === 'LIST' && error && <div style={errorBoxStyle}>{error}</div>}

      {mode.kind === 'LIST' && (
        <PeopleList
          people={people}
          onAddPerson={() => setMode({ kind: 'ADD' })}
          onViewPerson={(id) => setMode({ kind: 'DETAIL', personId: id })}
        />
      )}

      {mode.kind === 'ADD' && (
        <PersonForm
          mode="ADD"
          myPeopleEffective={myPeopleEffective}
          serverEnabled={serverEnabled}
          onSaved={() => {
            loadPeople();
            setMode({ kind: 'LIST' });
          }}
          onCancel={() => setMode({ kind: 'LIST' })}
        />
      )}

      {mode.kind === 'DETAIL' && (
        <PersonDetail
          personId={mode.personId}
          onEdit={() => setMode({ kind: 'EDIT', personId: mode.personId })}
          onDeleted={() => {
            loadPeople();
            setMode({ kind: 'LIST' });
          }}
        />
      )}

      {mode.kind === 'EDIT' && (
        <PersonForm
          mode="EDIT"
          myPeopleEffective={myPeopleEffective}
          personId={mode.personId}
          onSaved={() => {
            loadPeople();
            setMode({ kind: 'DETAIL', personId: mode.personId });
          }}
          onCancel={() => setMode({ kind: 'DETAIL', personId: mode.personId })}
        />
      )}
    </div>
  );
}

function PeopleList({ people, onAddPerson, onViewPerson }: { people: SavedPersonRow[] | null; onAddPerson: () => void; onViewPerson: (id: string) => void }) {
  if (people === null) {
    return <SurfaceCard><div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div></SurfaceCard>;
  }

  return (
    <>
      {people.length === 0 ? (
        <SurfaceCard>
          <EmptyState
            title="No people yet"
            description="Add someone you plan with -- a partner, family member, or friend -- to find shared moments."
            action={<PrimaryButton onClick={onAddPerson}>+ Add person</PrimaryButton>}
          />
        </SurfaceCard>
      ) : (
        <>
          <div style={typography.sectionEyebrow}>People you&apos;ve added</div>
          {people.map((person) => (
            <SurfaceCard key={person.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: colors.textPrimary }}>{RELATIONSHIP_ICON[person.relationshipType]} {person.name}</div>
                  <div style={{ fontSize: 12, color: colors.textFaint, marginTop: 3 }}>{RELATIONSHIP_LABEL[person.relationshipType]}</div>
                </div>
                <SecondaryButton onClick={() => onViewPerson(person.id)} style={{ minHeight: 38, padding: '0 14px' }}>
                  View
                </SecondaryButton>
              </div>
            </SurfaceCard>
          ))}
        </>
      )}

      {people.length > 0 && <PrimaryButton onClick={onAddPerson} style={{ width: '100%' }}>+ Add person</PrimaryButton>}
    </>
  );
}

function PersonDetail({ personId, onEdit, onDeleted }: { personId: string; onEdit: () => void; onDeleted: () => void }) {
  const [person, setPerson] = useState<SavedPersonDetail | null>(null);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Unable to load this person.');
        return res.json();
      })
      .then((data: SavedPersonDetail) => {
        if (!cancelled) setPerson(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/people/${personId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to delete this person.');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this person.');
      setDeleting(false);
    }
  };

  if (error) return <SurfaceCard><div style={errorBoxStyle}>{error}</div></SurfaceCard>;
  if (!person) return <SurfaceCard><div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div></SurfaceCard>;

  return (
    <>
      <SurfaceCard>
        <div style={{ fontSize: 18, fontWeight: 800, color: colors.textPrimary }}>{RELATIONSHIP_ICON[person.relationshipType]} {person.name}</div>
        <div style={{ fontSize: 12, color: colors.textFaint, marginTop: 3 }}>{RELATIONSHIP_LABEL[person.relationshipType]}</div>

        <div style={{ ...typography.sectionEyebrow, marginTop: spacing.lg }}>Birth details</div>
        {person.birthDate && person.birthTime ? (
          <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 1.7 }}>
            📅 {person.birthDate.slice(0, 10)} · ⏰ {person.birthTime}
            {person.birthCityName && <><br />📍 {person.birthCityName}</>}
          </div>
        ) : (
          // AURA-MP-1: a person may be saved without birth details.
          <div data-testid="person-no-birth-details" style={{ fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 1.7 }}>
            No birth details saved. Add them to include {person.name} in a shared Muhurtham.
          </div>
        )}

        {person.natalContext && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, marginTop: spacing.md }}>
            <PanchangaMiniCell label="Janma Rashi" value={person.natalContext.janmaRashi} />
            <PanchangaMiniCell label="Janma Nakshatra" value={person.natalContext.janmaNakshatra} />
          </div>
        )}

        <SecondaryButton onClick={onEdit} style={{ marginTop: spacing.lg }}>
          Edit
        </SecondaryButton>
      </SurfaceCard>

      <SurfaceCard>
        {!confirmingDelete ? (
          <button type="button" onClick={() => setConfirmingDelete(true)} style={dangerLinkStyle}>
            Remove {person.name} →
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>Remove {person.name}? Their details, notes and special days will be deleted. Your plans stay in your calendar. This can&apos;t be undone.</div>
            <div style={{ display: 'flex', gap: spacing.sm }}>
              <DestructiveButton onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing…' : 'Yes, remove'}
              </DestructiveButton>
              <SecondaryButton onClick={() => setConfirmingDelete(false)}>
                Cancel
              </SecondaryButton>
            </div>
          </div>
        )}
      </SurfaceCard>
    </>
  );
}

/**
 * R2 F1 (62009): the editor distinguishes four things and submits only the
 * second-to-last:
 *   1. ORIGINAL persisted values (snapshot from GET /api/people/:id);
 *   2. UI presentation defaults (e.g. a city select needs *some* value);
 *   3. EXPLICIT user edits (a field whose value differs from the original);
 *   4. explicit clearing (not offered by this legacy screen; the API supports
 *      `chart: null` only while My People is enabled).
 * An EDIT therefore sends only changed fields. The birth chart is all-or-none
 * by contract, so when the user edits ANY chart field the full chart is sent,
 * with every untouched part (timezone, city, coordinates) carried over from
 * the ORIGINAL record -- never from a presentation default. A save with no
 * changes sends nothing.
 */
const SAVED_LOCATION = '__saved_location__';
const NO_CITY = '';

/**
 * R4 (62014) -- the ONE field-handling contract for the Add and Edit forms:
 *
 *   untouched field        -> omitted (Add) / not sent (Edit); the API default
 *                             or the PERSISTED value stands (relationship on
 *                             Add -> API default OTHER; saved chart parts kept)
 *   explicitly changed     -> sent; for the all-or-none chart, the full chart
 *                             is sent with every untouched part taken from the
 *                             PERSISTED record
 *   explicitly cleared     -> "No location" clears city AND coordinates;
 *                             clearing the whole chart is API-only (chart:null)
 *   missing optional field -> stays missing; nothing is inferred (no default
 *                             city, coordinates, timezone or relationship)
 *   persisted values       -> the "saved location" is the saved city OR the
 *                             saved coordinates -- coordinates without a city
 *                             are a saved location too (never inferred absent)
 *   invalid combinations   -> refused before any request with an actionable
 *                             message; nothing is silently changed or dropped
 */
/** The API accepts coordinates only with a REGION timezone (one containing '/'). */
const timezoneAcceptsCoordinates = (tz: string) => tz.includes('/');

interface OriginalPerson {
  name: string;
  relationshipType: RelationshipType;
  birthDate: string; // 'YYYY-MM-DD' or ''
  birthTime: string; // 'HH:MM' or ''
  birthTimezone: string | null;
  birthCityName: string | null;
  birthLatitude: number | null;
  birthLongitude: number | null;
}

/** What the form currently holds. `birthTimezone` is its OWN control (R3). */
export interface PersonFormValues {
  name: string;
  relationshipType: RelationshipType | ''; // '' = not specified (Add only) -> omitted, API default applies
  birthDate: string;
  birthTime: string;
  birthTimezone: string; // '' = not chosen
  birthCity: string; // SAVED_LOCATION | NO_CITY | a city name
}

type PayloadResult = { ok: true; body: Record<string, unknown> | null } | { ok: false; error: string };

/**
 * R3 (62011): birth location is OPTIONAL in the approved contract -- a chart
 * is the all-or-none trio birth date + time + TIMEZONE; city and
 * coordinates are optional extras. The timezone is therefore its own
 * control: choosing a city fills in that city's timezone (and supplies its
 * coordinates), but no city is ever required to supply a timezone, and no
 * city, coordinates or timezone is ever persisted unless the user chose it.
 */
function chartFromValues(values: PersonFormValues, cities: CityOption[], location: { city: string | null; latitude: number | null; longitude: number | null } | null): PayloadResult | { ok: true; chart: Record<string, unknown> } {
  if (!values.birthDate || !values.birthTime) return { ok: false, error: 'Add both a birth date and a birth time, and a birth time zone -- or leave them all empty.' };
  if (!values.birthTimezone) return { ok: false, error: 'Choose a birth time zone.' };
  const chart: Record<string, unknown> = { birthDate: values.birthDate, birthTime: values.birthTime, birthTimezone: values.birthTimezone };
  if (values.birthCity !== NO_CITY && values.birthCity !== SAVED_LOCATION) {
    const chosen = cities.find((c) => c.cityName === values.birthCity);
    if (!chosen) return { ok: false, error: 'Choose a birth location from the list, or no location.' };
    Object.assign(chart, { birthCityName: chosen.cityName, birthLatitude: chosen.latitude, birthLongitude: chosen.longitude });
  } else if (values.birthCity === SAVED_LOCATION && location) {
    if (location.city) chart.birthCityName = location.city;
    if (location.latitude != null && location.longitude != null) Object.assign(chart, { birthLatitude: location.latitude, birthLongitude: location.longitude });
  }
  // R4 P2: the API accepts coordinates only with a region timezone. Refuse the
  // combination here, before any request -- never by dropping the location or
  // changing the chosen timezone.
  if (chart.birthLatitude != null && !timezoneAcceptsCoordinates(values.birthTimezone)) {
    return { ok: false, error: `The time zone "${values.birthTimezone}" can't be saved with a birth location. Choose a region time zone (for example Etc/UTC), or choose No location.` };
  }
  return { ok: true, chart };
}

/**
 * CREATE payload (R3). Name and relationship are always sent. Birth
 * information is sent only if the user entered any of it, and then as the
 * full trio (+ an explicitly chosen city's name and coordinates). With the
 * server's My People DISABLED the legacy contract requires birth
 * information; with it ENABLED a name-only person is valid.
 */
export function buildPersonCreatePayload(values: PersonFormValues, cities: CityOption[], serverEnabled: boolean): PayloadResult {
  // R4 P3: an untouched relationship is omitted -- the API default (OTHER) applies.
  const body: Record<string, unknown> = { name: values.name };
  if (values.relationshipType) body.relationshipType = values.relationshipType;
  const cityChosen = values.birthCity !== NO_CITY && values.birthCity !== SAVED_LOCATION;
  const anyChart = Boolean(values.birthDate || values.birthTime || values.birthTimezone || cityChosen);
  if (!anyChart) {
    if (!serverEnabled) return { ok: false, error: 'Add both a birth date and a birth time, and a birth time zone.' };
    return { ok: true, body };
  }
  const chart = chartFromValues(values, cities, null);
  if (!chart.ok) return chart;
  return { ok: true, body: { ...body, ...('chart' in chart ? chart.chart : {}) } };
}

/**
 * EDIT payload (R2 F1, extended in R3). Sends only fields the user changed.
 * Editing ANY birth field (date, time, timezone or city) sends the full
 * all-or-none chart; the untouched location (the SAVED city/coordinates, or
 * their absence) comes from the ORIGINAL record, never from a default. A
 * save with no changes sends nothing (null).
 */
export function buildPersonEditPayload(original: OriginalPerson, values: PersonFormValues, cities: CityOption[]): PayloadResult {
  const body: Record<string, unknown> = {};
  if (values.name !== original.name) body.name = values.name;
  if (values.relationshipType !== original.relationshipType) body.relationshipType = values.relationshipType;

  const hadChart = Boolean(original.birthDate && original.birthTime && original.birthTimezone);
  const initialCity = hasSavedLocation(original) ? SAVED_LOCATION : NO_CITY;
  const chartTouched =
    values.birthDate !== original.birthDate ||
    values.birthTime !== original.birthTime ||
    values.birthTimezone !== (original.birthTimezone ?? '') ||
    values.birthCity !== initialCity;

  if (chartTouched) {
    if (hadChart && (!values.birthDate || !values.birthTime)) return { ok: false, error: 'Birth date and birth time are both needed.' };
    const chart = chartFromValues(values, cities, { city: original.birthCityName, latitude: original.birthLatitude, longitude: original.birthLongitude });
    if (!chart.ok) return chart;
    if ('chart' in chart) Object.assign(body, chart.chart);
  }
  return { ok: true, body: Object.keys(body).length > 0 ? body : null };
}

/** R4 P1: a saved location is a saved city OR saved coordinates (a chart may hold coordinates without a city). */
function hasSavedLocation(original: OriginalPerson): boolean {
  const hadChart = Boolean(original.birthDate && original.birthTime && original.birthTimezone);
  return hadChart && Boolean(original.birthCityName || (original.birthLatitude != null && original.birthLongitude != null));
}

function savedLocationLabel(original: OriginalPerson): string {
  if (original.birthCityName) return `${original.birthCityName} (saved)`;
  return `Saved coordinates (${original.birthLatitude}, ${original.birthLongitude})`;
}

/**
 * IANA timezones for the independent birth-timezone control. R4 P2: UTC is
 * offered as its canonical region form Etc/UTC (equivalent, and accepted with
 * coordinates); zones without a region are not offered, except a value the
 * person already has saved (shown so it is never silently changed).
 */
function timezoneOptions(extra: Array<string | null | undefined>): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = CITY_OPTIONS.map((c) => c.timezone);
  const offered = [...zones, 'Etc/UTC'].filter((z) => z.includes('/'));
  return Array.from(new Set([...offered, ...extra.filter((z): z is string => Boolean(z))])).sort();
}

function PersonForm({ mode, personId, onSaved, onCancel, myPeopleEffective: listEffective = false, serverEnabled: listServerEnabled = false }: { mode: 'ADD' | 'EDIT'; personId?: string; onSaved: () => void; onCancel: () => void; myPeopleEffective?: boolean; serverEnabled?: boolean }) {
  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [name, setName] = useState('');
  // R4 P3: no relationship is pre-selected on Add.
  const [relationshipType, setRelationshipType] = useState<RelationshipType | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  // R3: the timezone is its own control; nothing is pre-selected on ADD.
  const [birthTimezone, setBirthTimezone] = useState('');
  // R2 F1 / R3: no city is pre-selected as a silent default.
  const [birthCity, setBirthCity] = useState<string>(NO_CITY);
  const [original, setOriginal] = useState<OriginalPerson | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(mode === 'ADD');
  // AURA-MP-1: an EDIT of a person saved without birth details must not
  // demand them -- name/relationship can be changed on their own, and the
  // chart is then left untouched (PATCH is partial).
  const [hadChart, setHadChart] = useState(false);
  // R1 F2: My People options only when the public flag is on AND the server
  // confirmed it (list response for ADD, detail response for EDIT).
  const [detailEffective, setDetailEffective] = useState<boolean | null>(null);
  const myPeopleEnabled = detailEffective ?? listEffective;
  // R3: ADD needs birth information only where the SERVER's contract does
  // (My People disabled). An EDIT keeps a chart required only for a person
  // who already has one (it can be corrected, not dropped here).
  const chartRequired = mode === 'ADD' ? !listServerEnabled : hadChart;

  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'EDIT' || !personId) return;
    fetch(`/api/people/${personId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Unable to load this person.');
        setDetailEffective(effectiveFromResponse(res));
        return res.json();
      })
      .then((data: SavedPersonDetail) => {
        const snapshot: OriginalPerson = {
          name: data.name,
          relationshipType: data.relationshipType,
          birthDate: data.birthDate ? data.birthDate.slice(0, 10) : '',
          birthTime: data.birthTime ?? '',
          birthTimezone: data.birthTimezone ?? null,
          birthCityName: data.birthCityName ?? null,
          birthLatitude: data.birthLatitude ?? null,
          birthLongitude: data.birthLongitude ?? null,
        };
        const withChart = personHasChartDetails(data);
        setOriginal(snapshot);
        setName(snapshot.name);
        setRelationshipType(snapshot.relationshipType);
        setHadChart(withChart);
        setBirthDate(snapshot.birthDate);
        setBirthTime(snapshot.birthTime);
        setBirthTimezone(snapshot.birthTimezone ?? '');
        setBirthCity(hasSavedLocation(snapshot) ? SAVED_LOCATION : NO_CITY);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [mode, personId]);

  const combinedCities: CityOption[] = useMemo(
    () => [...CITY_OPTIONS, ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName))],
    [customCities]
  );
  const zones = useMemo(() => timezoneOptions([original?.birthTimezone, ...combinedCities.map((c) => c.timezone)]), [original, combinedCities]);

  /** Choosing a city fills in its timezone; choosing "no city" keeps the timezone. */
  const onCityChange = (value: string) => {
    setBirthCity(value);
    const chosen = combinedCities.find((c) => c.cityName === value);
    if (chosen) setBirthTimezone(chosen.timezone);
    else if (value === SAVED_LOCATION && original?.birthTimezone) setBirthTimezone(original.birthTimezone);
  };

  const save = async (method: 'POST' | 'PATCH', url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to save this person.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const values: PersonFormValues = { name, relationshipType, birthDate, birthTime, birthTimezone, birthCity };
    try {
      if (mode === 'EDIT') {
        if (!original || !personId) throw new Error('Unable to load this person.');
        const payload = buildPersonEditPayload(original, values, combinedCities);
        if (!payload.ok) throw new Error(payload.error);
        // Nothing changed: nothing is sent, nothing is written.
        if (payload.body) await save('PATCH', `/api/people/${personId}`, payload.body);
      } else {
        const payload = buildPersonCreatePayload(values, combinedCities, listServerEnabled);
        if (!payload.ok) throw new Error(payload.error);
        await save('POST', '/api/people', payload.body!);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this person.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <SurfaceCard><div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div></SurfaceCard>;

  const relationshipOptions = RELATIONSHIP_OPTIONS.filter((o) => !o.myPeopleOnly || myPeopleEnabled || o.value === relationshipType);

  return (
    <form onSubmit={handleSubmit} style={theme.surfaceCardStyle}>
      <div style={typography.sectionEyebrow}>{mode === 'ADD' ? 'Add someone' : 'Edit person'}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div>
          <FieldLabel htmlFor="person-name">Name</FieldLabel>
          <TextInput id="person-name" required type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>

        <div>
          <FieldLabel htmlFor="person-relationship">Relationship</FieldLabel>
          <SelectInput id="person-relationship" value={relationshipType} onChange={(e) => setRelationshipType(e.target.value as RelationshipType | '')}>
            {mode === 'ADD' && <option value="">Not specified</option>}
            {relationshipOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
            ))}
          </SelectInput>
        </div>

        <div>
          <FieldLabel htmlFor="person-birth-date">Birth date</FieldLabel>
          <TextInput id="person-birth-date" required={chartRequired} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>

        <div>
          <FieldLabel htmlFor="person-birth-time">Birth time</FieldLabel>
          <TextInput id="person-birth-time" required={chartRequired} type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} />
        </div>

        <div>
          <FieldLabel htmlFor="person-birth-timezone">Birth time zone</FieldLabel>
          <SelectInput id="person-birth-timezone" required={chartRequired} value={birthTimezone} onChange={(e) => setBirthTimezone(e.target.value)}>
            <option value="">{chartRequired ? 'Choose a time zone…' : 'Not set'}</option>
            {zones.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </SelectInput>
        </div>

        <div>
          <FieldLabel htmlFor="person-birth-city">Birth location (optional)</FieldLabel>
          <SelectInput id="person-birth-city" value={birthCity} onChange={(e) => onCityChange(e.target.value)}>
            {original && hasSavedLocation(original) && <option value={SAVED_LOCATION}>{savedLocationLabel(original)}</option>}
            <option value={NO_CITY}>No location</option>
            {combinedCities.map((c) => (
              <option key={c.cityName} value={c.cityName}>{c.cityName}</option>
            ))}
          </SelectInput>
        </div>

        <PrimaryButton type="submit" disabled={saving} style={{ width: '100%', marginTop: 4 }}>
          {saving ? 'Saving…' : 'Save person'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} style={{ width: '100%' }}>
          Cancel
        </SecondaryButton>
        {error && <div style={errorBoxStyle}>{error}</div>}
      </div>
    </form>
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

const backButtonStyle: React.CSSProperties = theme.backButtonStyle;

const dangerLinkStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: theme.colors.danger,
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
  padding: 0,
};


const errorBoxStyle: React.CSSProperties = theme.errorBoxStyle;

const panchangaCellStyle: React.CSSProperties = theme.cellStyle;
