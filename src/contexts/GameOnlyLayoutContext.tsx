import React, { createContext, useContext } from "react";

const GameOnlyLayoutContext = createContext(false);

export const GameOnlyLayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <GameOnlyLayoutContext.Provider value={true}>{children}</GameOnlyLayoutContext.Provider>
);

export const useGameOnlyLayout = (): boolean => useContext(GameOnlyLayoutContext);
