import { createApp } from './app';
import { EnvError, loadEnv } from './env';

const main = async (): Promise<void> => {
  const env = loadEnv();
  const { app } = await createApp(env);
  app.enableShutdownHooks();
  await app.listen(env.PORT, env.HOST);
  console.log(`API listening on http://${env.HOST}:${env.PORT} (docs at /docs)`);
};

main().catch((err: unknown) => {
  if (err instanceof EnvError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
