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

  const loadPeople = async () => {
    setError('');
    try {
      const res = await fetch('/api/people');
      if (!res.ok) throw new Error('Unable to load people.');
      setMyPeopleEffective(effectiveFromResponse(res));
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

/** The PATCH body for an EDIT, or null when nothing changed. Exported for tests. */
export function buildPersonEditPayload(
  original: OriginalPerson,
  edited: { name: string; relationshipType: RelationshipType; birthDate: string; birthTime: string; birthCity: string },
  cities: CityOption[]
): { ok: true; body: Record<string, unknown> | null } | { ok: false; error: string } {
  const body: Record<string, unknown> = {};
  if (edited.name !== original.name) body.name = edited.name;
  if (edited.relationshipType !== original.relationshipType) body.relationshipType = edited.relationshipType;

  const hadChart = Boolean(original.birthDate && original.birthTime && original.birthTimezone);
  const cityChosen = edited.birthCity !== SAVED_LOCATION && edited.birthCity !== NO_CITY;
  const dateChanged = edited.birthDate !== original.birthDate;
  const timeChanged = edited.birthTime !== original.birthTime;

  if (hadChart) {
    if (dateChanged || timeChanged || cityChosen) {
      if (!edited.birthDate || !edited.birthTime) return { ok: false, error: 'Birth date and birth time are both needed.' };
      const chosen = cityChosen ? cities.find((c) => c.cityName === edited.birthCity) : undefined;
      if (cityChosen && !chosen) return { ok: false, error: 'Choose a birth location from the list.' };
      body.birthDate = edited.birthDate;
      body.birthTime = edited.birthTime;
      if (chosen) {
        body.birthTimezone = chosen.timezone;
        body.birthCityName = chosen.cityName;
        body.birthLatitude = chosen.latitude;
        body.birthLongitude = chosen.longitude;
      } else {
        // Location untouched: carry the ORIGINAL location exactly, including
        // its absence (no city / no coordinates stay absent).
        body.birthTimezone = original.birthTimezone;
        if (original.birthCityName) body.birthCityName = original.birthCityName;
        if (original.birthLatitude != null && original.birthLongitude != null) {
          body.birthLatitude = original.birthLatitude;
          body.birthLongitude = original.birthLongitude;
        }
      }
    }
  } else {
    const anyChart = Boolean(edited.birthDate || edited.birthTime || cityChosen);
    if (anyChart) {
      if (!edited.birthDate || !edited.birthTime || !cityChosen) {
        return { ok: false, error: 'Add both a birth date and a birth time, and a birth location -- or leave all three empty.' };
      }
      const chosen = cities.find((c) => c.cityName === edited.birthCity);
      if (!chosen) return { ok: false, error: 'Choose a birth location from the list.' };
      Object.assign(body, { birthDate: edited.birthDate, birthTime: edited.birthTime, birthTimezone: chosen.timezone, birthCityName: chosen.cityName, birthLatitude: chosen.latitude, birthLongitude: chosen.longitude });
    }
  }
  return { ok: true, body: Object.keys(body).length > 0 ? body : null };
}

function PersonForm({ mode, personId, onSaved, onCancel, myPeopleEffective: listEffective = false }: { mode: 'ADD' | 'EDIT'; personId?: string; onSaved: () => void; onCancel: () => void; myPeopleEffective?: boolean }) {
  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [name, setName] = useState('');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('PARTNER');
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  // R2 F1: no city is pre-selected as a silent default. ADD asks for an
  // explicit choice; EDIT starts on the person's SAVED location.
  const [birthCity, setBirthCity] = useState<string>(NO_CITY);
  const [original, setOriginal] = useState<OriginalPerson | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(mode === 'ADD');
  // AURA-MP-1: an EDIT of a person saved without birth details must not
  // demand them -- name/relationship can be changed on their own, and the
  // chart is then left untouched (PATCH is partial).
  const [hadChart, setHadChart] = useState(mode === 'ADD');
  // R1 F2: My People options only when the public flag is on AND the server
  // confirmed it (list response for ADD, detail response for EDIT).
  const [detailEffective, setDetailEffective] = useState<boolean | null>(null);
  const myPeopleEnabled = detailEffective ?? listEffective;
  // ADD on this (legacy) screen still asks for birth details; the name-only
  // add flow is the My People screen (MP-2). An EDIT keeps a chart required
  // only for a person who already has one (it can be corrected, not dropped).
  const chartRequired = mode === 'ADD' || hadChart;

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
        setOriginal(snapshot);
        setName(snapshot.name);
        setRelationshipType(snapshot.relationshipType);
        setHadChart(personHasChartDetails(data));
        setBirthDate(snapshot.birthDate);
        setBirthTime(snapshot.birthTime);
        setBirthCity(personHasChartDetails(data) ? SAVED_LOCATION : NO_CITY);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [mode, personId]);

  const combinedCities: CityOption[] = useMemo(
    () => [...CITY_OPTIONS, ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName))],
    [customCities]
  );

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
    try {
      if (mode === 'EDIT') {
        if (!original || !personId) throw new Error('Unable to load this person.');
        const payload = buildPersonEditPayload(original, { name, relationshipType, birthDate, birthTime, birthCity }, combinedCities);
        if (!payload.ok) throw new Error(payload.error);
        // Nothing changed: nothing is sent, nothing is written.
        if (payload.body) await save('PATCH', `/api/people/${personId}`, payload.body);
      } else {
        const city = combinedCities.find((c) => c.cityName === birthCity);
        if (!city) throw new Error('Choose a birth location.');
        await save('POST', '/api/people', {
          name,
          relationshipType,
          birthDate,
          birthTime,
          birthTimezone: city.timezone,
          birthCityName: city.cityName,
          birthLatitude: city.latitude,
          birthLongitude: city.longitude,
        });
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
  const savedLocationLabel = original && hadChart
    ? original.birthCityName
      ? `${original.birthCityName} (saved)`
      : `Saved time zone: ${original.birthTimezone}`
    : null;

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
          <SelectInput id="person-relationship" value={relationshipType} onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}>
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
          <FieldLabel htmlFor="person-birth-city">Birth location</FieldLabel>
          <SelectInput id="person-birth-city" required={mode === 'ADD'} value={birthCity} onChange={(e) => setBirthCity(e.target.value)}>
            {savedLocationLabel ? (
              <option value={SAVED_LOCATION}>{savedLocationLabel}</option>
            ) : (
              <option value={NO_CITY}>{mode === 'ADD' ? 'Choose a city…' : 'Not set'}</option>
            )}
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
