import { Banner } from "@langchain/macaw-components/Banner";

import { SignIn } from "../auth/SignIn";
import { useSession } from "../auth/useSession";
import { ChatShell } from "../chat/ChatShell";
import { findEnvironment, parseConfig, type AppConfig } from "../config";
import { useHashRoute } from "./useHashRoute";

const configResult = parseConfig(import.meta.env);

export function App() {
  if (!configResult.ok) {
    return (
      <div className="mx-auto max-w-xl p-space-6">
        <Banner intent="error" title="This build is missing configuration">
          <ul className="list-disc pl-space-5">
            {configResult.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Banner>
      </div>
    );
  }
  return <ConfiguredApp config={configResult.config} />;
}

function ConfiguredApp({ config }: { readonly config: AppConfig }) {
  const [route, navigate] = useHashRoute();
  const { state, langsmith, lastAccount, forgetAccount, signInWithKey, signOut } =
    useSession(config);
  const environment = findEnvironment(config, route.environment);

  if (state.status === "checking") return null;
  if (state.status === "signed-out") {
    return (
      <SignIn
        environment={environment}
        workspaceId={config.workspaceId}
        langsmith={langsmith}
        problem={state.problem}
        lastAccount={lastAccount}
        onForgetAccount={forgetAccount}
        onSignIn={signInWithKey}
      />
    );
  }

  return (
    <ChatShell
      config={config}
      environment={environment}
      threadId={route.threadId}
      auth={state.session}
      onNavigate={navigate}
      onSignOut={() => void signOut()}
    />
  );
}
