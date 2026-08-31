import { loadAppSnapshot, saveAppSnapshot } from "../shared/storage";

void loadAppSnapshot().then(saveAppSnapshot).catch(() => undefined);
