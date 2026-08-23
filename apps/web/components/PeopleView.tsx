'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CITY_OPTIONS } from '../lib/cities';
import type { CityOption } from '../lib/cities';
import * as theme from './theme';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, DestructiveButton, EmptyState } from './ui';

export type RelationshipType = 'PARTNER' | 'SPOUSE' | 'FAMILY' | 'FRIEND' | 'OTHER';

export interface SavedPersonRow {
  id: string;
  name: string;
  relationshipType: RelationshipType;
  birthDate: string;
  birthTime: string;
  birthTimezone: string;
  birthCityName: string | null;
  birthLatitude: number | null;
  birthLongitude: number | null;
}

interface SavedPersonDetail extends SavedPersonRow {
  natalContext: { janmaNakshatra: string; janmaRashi: string; moonElement: string } | null;
}

interface PeopleViewProps {
  onBack: () => void;
}

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipType; label: string; icon: string }> = [
  { value: 'PARTNER', label: 'Partner', icon: '❤️' },
  { value: 'SPOUSE', label: 'Spouse', icon: '💍' },
  { value: 'FAMILY', label: 'Family', icon: '👪' },
  { value: 'FRIEND', label: 'Friend', icon: '🤝' },
  { value: 'OTHER', label: 'Other', icon: '👤' },
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

  const loadPeople = async () => {
    setError('');
    try {
      const res = await fetch('/api/people');
      if (!res.ok) throw new Error('Unable to load people.');
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
        <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 1.7 }}>
          📅 {person.birthDate.slice(0, 10)} · ⏰ {person.birthTime}
          {person.birthCityName && <><br />📍 {person.birthCityName}</>}
        </div>

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
            <div style={{ fontSize: 12, color: colors.textSecondary }}>Remove {person.name}? This can&apos;t be undone.</div>
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

function PersonForm({ mode, personId, onSaved, onCancel }: { mode: 'ADD' | 'EDIT'; personId?: string; onSaved: () => void; onCancel: () => void }) {
  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [name, setName] = useState('');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('PARTNER');
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [birthCity, setBirthCity] = useState(CITY_OPTIONS[0]?.cityName || 'Chennai');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(mode === 'ADD');

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
        return res.json();
      })
      .then((data: SavedPersonDetail) => {
        setName(data.name);
        setRelationshipType(data.relationshipType);
        setBirthDate(data.birthDate.slice(0, 10));
        setBirthTime(data.birthTime);
        if (data.birthCityName) setBirthCity(data.birthCityName);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [mode, personId]);

  const combinedCities: CityOption[] = useMemo(
    () => [...CITY_OPTIONS, ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName))],
    [customCities]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const city = combinedCities.find((c) => c.cityName === birthCity) || combinedCities[0];
    try {
      const res = await fetch(mode === 'ADD' ? '/api/people' : `/api/people/${personId}`, {
        method: mode === 'ADD' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          relationshipType,
          birthDate,
          birthTime,
          birthTimezone: city.timezone,
          birthCityName: city.cityName,
          birthLatitude: city.latitude,
          birthLongitude: city.longitude,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to save this person.');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this person.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <SurfaceCard><div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div></SurfaceCard>;

  return (
    <form onSubmit={handleSubmit} style={theme.surfaceCardStyle}>
      <div style={typography.sectionEyebrow}>{mode === 'ADD' ? 'Add someone' : 'Edit person'}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <label style={fieldLabelStyle}>
          Name
          <input required type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} maxLength={80} />
        </label>

        <label style={fieldLabelStyle}>
          Relationship
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value as RelationshipType)} style={inputStyle}>
            {RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
            ))}
          </select>
        </label>

        <label style={fieldLabelStyle}>
          Birth date
          <input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} style={inputStyle} />
        </label>

        <label style={fieldLabelStyle}>
          Birth time
          <input required type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} style={inputStyle} />
        </label>

        <label style={fieldLabelStyle}>
          Birth location
          <select value={birthCity} onChange={(e) => setBirthCity(e.target.value)} style={inputStyle}>
            {combinedCities.map((c) => (
              <option key={c.cityName} value={c.cityName}>{c.cityName}</option>
            ))}
          </select>
        </label>

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

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 11,
  color: '#94a3b8',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const inputStyle: React.CSSProperties = {
  minHeight: 42,
  borderRadius: 10,
  border: '1px solid rgba(255, 255, 255, 0.12)',
  background: 'rgba(2, 6, 23, 0.5)',
  color: '#f8fafc',
  fontSize: 14,
  padding: '0 10px',
};

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
