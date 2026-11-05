import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/** Go to the previous in-app page, or a safe destination when opened directly. */
export function useBackNavigation(fallbackPath: string) {
  const navigate = useNavigate();

  return useCallback(() => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate(fallbackPath, { replace: true });
  }, [fallbackPath, navigate]);
}
