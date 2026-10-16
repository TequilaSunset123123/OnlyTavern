import { createContext, useContext } from 'react'

/** "Next day" / "+7" with the show around it (TimeTravel.tsx); busy while it runs. */
export const TimeTravelContext = createContext<{ advance: (days: number) => void; busy: boolean }>({ advance: () => {}, busy: false })

export const useTimeTravel = () => useContext(TimeTravelContext)
