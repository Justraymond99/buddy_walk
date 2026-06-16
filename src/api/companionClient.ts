import axios from 'axios';

import { COMPANION_API_ROOT } from './client';

export const companionApiClient = axios.create({
  baseURL: `${COMPANION_API_ROOT}/api`,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});
