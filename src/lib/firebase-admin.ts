import 'server-only'

import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const APP_NAME = 'auradeck-crm'

function getFirebaseAdminApp(): App {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID must be configured to connect to Firestore.')
  }

  const existing = getApps().find((app) => app.name === APP_NAME)
  if (existing) return existing

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  }, APP_NAME)
}

export function getFirebaseAdminFirestore(): Firestore {
  return getFirestore(getFirebaseAdminApp())
}

export async function checkFirestoreConnection(): Promise<void> {
  await getFirebaseAdminFirestore().listCollections()
}
