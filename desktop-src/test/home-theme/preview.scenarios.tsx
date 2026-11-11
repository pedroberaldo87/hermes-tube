// Preview scenarios of Home's theme entry points (the real Home over the fake ctx of the preview): the "New theme"
// button next to "+ New tab", the same button with no AI model, and a theme building in the background (the notice
// in the tab strip with the elapsed time). The data is Home's own "full · comfortable" scenario plus the routes the
// theme entry reads (GET /ai/status, GET /jobs, GET /jobs/{id}). Preview only (outside the bundle).
import { type ReactNode, useState } from 'react'
import type { Job, Progress } from '../../../shared/api-types'
import type { Scenario } from '../../components'
import { writeThemePending } from '../../lib/jobs'
import { HomeView } from '../../pages/home'
import { scenarios as homeScenarios } from '../../pages/home/preview.scenarios'

const WIDTHS = [420, 900, 1440]
const nowS = () => Math.floor(Date.now() / 1000)
const ELAPSED_S = 83

const homeRest = (): NonNullable<Scenario['rest']> => ({ ...((homeScenarios.find((s) => s.id === 'home-comfortable')?.rest ?? {}) as NonNullable<Scenario['rest']>) })

const AI_OK = { 'GET /ai/status': { available: true, model: 'claude-opus-5-5', reason: null } }
const AI_OFF = { 'GET /ai/status': { available: false, model: null, reason: 'no_model' } }
const NO_JOBS = { 'GET /jobs': { items: [] } }

const curating: Progress = { stage: 'curate', done: 2, total: 4, message: null, step: { name: 'curate', done: 80, total: 160 } }

function running(): Job {
  return { id: 'job_astro', kind: 'theme', status: 'running', created_at: nowS() - ELAPSED_S, updated_at: nowS(), progress: curating, result: null, error: null }
}

/** Writes the stored job (as the theme dialog does) before Home reads it. */
function Stored({ children }: { children: ReactNode }) {
  useState(() => writeThemePending({ jobId: 'job_astro', query: 'Astrophysics', at: Date.now() - ELAPSED_S * 1000, params: { query: 'Astrophysics' } }))
  return <>{children}</>
}

export const scenarios: Scenario[] = [
  {
    id: 'home-theme-button',
    title: 'Subscriptions · "New topic tab" next to "+ New tab" (icon only when narrow)',
    widths: WIDTHS,
    rest: { ...homeRest(), ...AI_OK, ...NO_JOBS },
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" />
  },
  {
    id: 'home-theme-no-ai',
    title: 'Subscriptions · "New topic tab" disabled: no AI model',
    widths: WIDTHS,
    rest: { ...homeRest(), ...AI_OFF, ...NO_JOBS },
    render: () => <HomeView initialTab="all-new" initialDensity="comfortable" />
  },
  {
    id: 'home-theme-building',
    title: 'Subscriptions · a topic tab building in the background (notice with the elapsed time)',
    widths: WIDTHS,
    rest: { ...homeRest(), ...AI_OK, 'GET /jobs': () => ({ items: [running()] }), 'GET /jobs/{id}': () => running() },
    render: () => (
      <Stored>
        <HomeView initialTab="all-new" initialDensity="comfortable" />
      </Stored>
    )
  }
]
