import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SESSIONS_ROUTE_SEGMENT } from "../constants/routes";
import { useTelemetry } from "../context/TelemetryContext";
import {
  ALL_FORMULA_SCOPE_KEY,
  getSessionFormulaScopeKey,
  isAllFormulaScope,
} from "../utils/formulaScope";
import { dashboardPath, replaceFormulaScopeInPath } from "../utils/routes";

/**
 * The game lives in the URL's first segment, so picking one swaps that segment
 * and keeps the rest of the page. The picker only matters with 2+ games.
 */
export function useGameScope() {
  const { formulaOptions, scopeKey, activeFormula, sessions } = useTelemetry();
  const location = useLocation();
  const navigate = useNavigate();

  const enabled = formulaOptions.length > 1;
  const value = scopeKey ?? ALL_FORMULA_SCOPE_KEY;
  const options = [
    { value: ALL_FORMULA_SCOPE_KEY, label: "All games" },
    ...formulaOptions.map((option) => ({
      value: option.key,
      label: option.label,
    })),
  ];

  const setGame = useCallback(
    (nextKey: string) => {
      if (nextKey === scopeKey) return;

      const [, section, ...rest] = location.pathname.split("/").filter(Boolean);

      // A session only exists in its own game; picking another game from its
      // page goes to that game's dashboard instead.
      if (section === SESSIONS_ROUTE_SEGMENT && !isAllFormulaScope(nextKey)) {
        const slug = rest.join("/");
        const session = sessions.find((s) => s.slug === slug);
        if (!session || getSessionFormulaScopeKey(session) !== nextKey) {
          navigate(dashboardPath(nextKey));
          return;
        }
      }

      if (!scopeKey) {
        navigate(dashboardPath(nextKey));
        return;
      }

      const nextParams = new URLSearchParams(location.search);
      nextParams.delete("raceLaps");
      const nextSearch = nextParams.toString();
      navigate(
        `${replaceFormulaScopeInPath(location.pathname, nextKey)}${
          nextSearch ? `?${nextSearch}` : ""
        }`,
      );
    },
    [location.pathname, location.search, navigate, scopeKey, sessions],
  );

  return {
    enabled,
    value,
    options,
    isFiltered: enabled && !isAllFormulaScope(value),
    label: activeFormula?.label,
    setGame,
  };
}

export type GameScope = ReturnType<typeof useGameScope>;
