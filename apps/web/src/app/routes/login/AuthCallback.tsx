import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { setToken } from "../../../api/client";
import { useAuth } from "../../../auth/AuthProvider";

export function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refetchUser } = useAuth();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      // Re-fetch user so AuthProvider knows we're logged in, then navigate.
      // This avoids a hard page reload while still updating auth state.
      refetchUser();
      navigate("/", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [params, navigate, refetchUser]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
    </div>
  );
}
