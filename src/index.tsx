/// <reference path="./index.d.ts" />
import * as React from 'react'
import Global from './global'
import { PureComponent, useCallback, useEffect, useState } from 'react'
import { GlobalContext, Consumer, setPartialState } from './helper'
import { actionMiddlewares, applyMiddlewares } from './middlewares'

const getInitialState = async () => {
  await Promise.all(
    Object.keys(Global.State).map(async modelName => {
      const model = Global.State[modelName]
      const asyncState = model.asyncState ? await model.asyncState() : {}
      Global.State[modelName].state = {
        ...Global.State[modelName].state,
        ...asyncState
      }
    })
  )
  return Global.State
}

const Model = <M extends Models>(models: M, initialModels?: M) => {
  Global.State = initialModels
    ? Object.keys(models).reduce((o: any, key) => {
        o[key] = {
          actions: models[key].actions,
          state: { ...models[key].state, ...initialModels[key].state }
        }
        return o
      }, {})
    : {
        ...models
      }

  Global.withDevTools =
    typeof window !== 'undefined' &&
    (window as any).__REDUX_DEVTOOLS_EXTENSION__
  if (Global.withDevTools) {
    Global.devTools = (window as any).__REDUX_DEVTOOLS_EXTENSION__
    Global.devTools.connect()
  }
  return { useStore, getState, getInitialState } as {
    useStore: <K extends keyof M>(
      name: K,
      models?: M
    ) => [Get<M[K], 'state'>, getConsumerActionsType<Get<M[K], 'actions'>>]
    getState: <K extends keyof M>(modelName: K) => Readonly<Get<M[K], 'state'>>
    getInitialState: typeof getInitialState
  }
}

const getState = (modelName: keyof typeof Global.State) => {
  return (Global.State as any)[modelName].state
}

const useStore = (modelName: string) => {
  // const _state = useContext(GlobalContext)
  const [state, setState] = useState(Global.State[modelName].state)
  Global.uid += 1
  const _hash = '' + Global.uid
  if (!Global.Setter.functionSetter[modelName])
    Global.Setter.functionSetter[modelName] = []
  Global.Setter.functionSetter[modelName][_hash] = { setState }
  useEffect(() => {
    return function cleanup() {
      delete Global.Setter.functionSetter[modelName][_hash]
    }
  })
  const updaters: any = {}
  const consumerAction = (action: Action) => async (params: any) => {
    const context: Context = {
      modelName,
      setState,
      actionName: action.name,
      next: () => {},
      newState: null,
      params,
      consumerActions,
      action
    }
    applyMiddlewares(actionMiddlewares, context)
  }
  const consumerActions = (actions: any) => {
    let ret: any = {}
    Object.keys(actions).map((key: string) => {
      ret[key] = consumerAction(actions[key])
    })
    return ret
  }
  Object.keys(Global.State[modelName].actions).map(
    key =>
      (updaters[key] = useCallback(
        async (params: any) => {
          const context: Context = {
            modelName,
            setState,
            actionName: key,
            next: () => {},
            newState: null,
            params,
            consumerActions,
            action: Global.State[modelName].actions[key]
          }
          applyMiddlewares(actionMiddlewares, context)
        },
        []
        // [Global.State[modelName]]
      ))
  )
  return [state, updaters]
}

// Bridge API
// Use to migrate from old class component.
// These APIs won't be updated for advance feature.
class Provider extends PureComponent<{}, ProviderProps> {
  state = Global.State
  render() {
    const { children } = this.props
    Global.Setter.classSetter = this.setState.bind(this)
    return (
      <GlobalContext.Provider
        value={{ ...Global.State, setState: this.setState.bind(this) }}
      >
        {children}
      </GlobalContext.Provider>
    )
  }
}

const connect = (modelName: string, mapProps: Function | undefined) => (
  Component: typeof React.Component | typeof PureComponent
) =>
  class P extends PureComponent<{}> {
    render() {
      return (
        <Consumer>
          {models => {
            const {
              [`${modelName}`]: { state, actions },
              setState
            } = models as any
            const consumerAction = (action: any) => async (...params: any) => {
              const newState = await action(
                Global.State[modelName].state,
                consumerActions(actions),
                ...params
              )
              if (newState) {
                setPartialState(modelName, newState)
                setState(Global.State)
                Object.keys(Global.Setter.functionSetter[modelName]).map(
                  key =>
                    Global.Setter.functionSetter[modelName][key] &&
                    Global.Setter.functionSetter[modelName][key].setState(
                      Global.State[modelName].state
                    )
                )
              }
            }
            const consumerActions = (actions: any) => {
              let ret: any = {}
              Object.keys(actions).map((key: string) => {
                ret[key] = consumerAction(actions[key])
              })
              return ret
            }

            return (
              <Component
                state={mapProps ? mapProps(state) : state}
                actions={consumerActions(actions)}
              />
            )
          }}
        </Consumer>
      )
    }
  }

export {
  actionMiddlewares,
  Model,
  Provider,
  Consumer,
  connect,
  getState,
  getInitialState
}
