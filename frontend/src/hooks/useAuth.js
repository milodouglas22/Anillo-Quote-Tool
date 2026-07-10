import { useMsal, useAccount } from "@azure/msal-react";
import { loginRequest, apiRequest } from "../config/authConfig";

export function useAuth() {
  const { instance, accounts, inProgress } = useMsal();
  const account = useAccount(accounts[0] || null);

  const isAuthenticated = accounts.length > 0;

  const login = async () => {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = async () => {
    try {
      await instance.logoutRedirect({
        postLogoutRedirectUri: window.location.origin,
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const getAccessToken = async () => {
    if (!account) return null;
    try {
      const response = await instance.acquireTokenSilent({
        ...apiRequest,
        account: account,
      });
      return response.accessToken;
    } catch (error) {
      console.error("Token acquisition failed:", error);
      try {
        await instance.acquireTokenRedirect(apiRequest);
      } catch (redirectError) {
        console.error("Token redirect failed:", redirectError);
      }
      return null;
    }
  };

  const getUser = () => {
    if (!account) return null;
    return {
      name: account.name,
      email: account.username,
      id: account.localAccountId,
    };
  };

  return {
    isAuthenticated,
    login,
    logout,
    getAccessToken,
    getUser,
    inProgress,
    account,
  };
}
