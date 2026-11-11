// Dialog registry: any screen opens a dialog by id with typed props, without importing the dialog.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DIALOG_IDS, type DialogId, type DialogProps } from '../../shared/ids'
import {
  $dialogStack,
  DialogHost,
  type DialogRegistry,
  closeAllDialogs,
  closeDialog,
  openDialog,
  registerDialogs
} from '../lib/dialogs'
import { act } from 'react'
import { click, render } from './render'

function stub<K extends DialogId>(id: K) {
  return (props: DialogProps[K] & { onClose: () => void }) => (
    <div data-dialog={id}>
      <span data-props>{JSON.stringify({ ...props, onClose: undefined })}</span>
      <button type="button" data-close onClick={props.onClose}>
        close
      </button>
    </div>
  )
}

const STUBS: DialogRegistry = {
  onboarding: stub('onboarding'),
  'tab-editor': stub('tab-editor'),
  organize: stub('organize'),
  theme: stub('theme'),
  'list-import': stub('list-import'),
  history: stub('history'),
  'create-tab': stub('create-tab')
}

beforeEach(() => {
  registerDialogs(STUBS)
})

const shown = (root: HTMLElement) => [...root.querySelectorAll('[data-dialog]')].map((e) => e.getAttribute('data-dialog'))

describe('openDialog + DialogHost', () => {
  it('opens the registered dialog with the props and closes through onClose', () => {
    const view = render(<DialogHost />)
    expect(shown(view.container)).toEqual([])
    act(() => {
      openDialog('theme', { query: 'rust' })
    })
    expect(shown(view.container)).toEqual(['theme'])
    expect(view.container.querySelector('[data-props]')?.textContent).toBe('{"query":"rust"}')
    click(view.container.querySelector('[data-close]'))
    expect(shown(view.container)).toEqual([])
  })

  it('stack: the top one shows; closing goes back to the previous', () => {
    const view = render(<DialogHost />)
    act(() => {
      openDialog('onboarding', { step: 'pair' })
    })
    act(() => {
      openDialog('tab-editor', { tabId: 'tab_1' })
    })
    expect(shown(view.container)).toEqual(['tab-editor'])
    act(() => {
      closeDialog()
    })
    expect(shown(view.container)).toEqual(['onboarding'])
    act(() => {
      closeAllDialogs()
    })
    expect(shown(view.container)).toEqual([])
    expect($dialogStack.get()).toEqual([])
  })

  it('optional props can be omitted; required ones are enforced by the type', () => {
    openDialog('history')
    openDialog('organize')
    openDialog('create-tab', { channelIds: ['UCBJycsmduvYEL83R_U4JriQ'] })
    // @ts-expect-error create-tab requires channelIds
    openDialog('create-tab')
    // @ts-expect-error unknown prop for theme
    openDialog('theme', { tabId: 'x' })
    expect($dialogStack.get().map((d) => d.id)).toEqual(['history', 'organize', 'create-tab', 'create-tab', 'theme'])
  })

  it('several mounted hosts (status bar, pane, page) render the dialog only once', () => {
    const view = render(
      <div>
        <DialogHost />
        <DialogHost />
        <DialogHost />
      </div>
    )
    act(() => {
      openDialog('organize', { channelIds: ['a'] })
    })
    view.rerender(
      <div>
        <DialogHost />
        <DialogHost />
        <DialogHost />
      </div>
    )
    expect(shown(view.container)).toEqual(['organize'])
  })

  it('an id without a registered component does not break (warns in the console)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registerDialogs({ ...STUBS, theme: undefined } as unknown as DialogRegistry)
    const view = render(<DialogHost />)
    act(() => {
      openDialog('theme', {})
    })
    expect(shown(view.container)).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('DIALOG_IDS covers exactly the DialogProps keys used in the registry', () => {
    expect(Object.keys(STUBS).sort()).toEqual(Object.values(DIALOG_IDS).sort())
  })
})
