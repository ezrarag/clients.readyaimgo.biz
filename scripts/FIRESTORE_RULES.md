# Firestore Security Rules

Paste this into Firebase Console -> Firestore -> Rules -> Publish.

## Why these rules exist

- `organizations/{orgId}` is the shared client workspace boundary.
- `organizations/{orgId}/members/{uid}` controls role-based access.
- `clients/{email}` remains for backward compatibility and first-login migration.
- `handoffs`, `partners`, `mail`, and most note writes are handled through Admin SDK API routes.
- Catch-all denies everything not explicitly listed.

## Rules - copy everything below this line

```

## Firebase Storage Rules

Paste this into Firebase Console -> Storage -> Rules if uploads are blocked.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function isOrgMember(orgId) {
      return signedIn() &&
        firestore.exists(/databases/(default)/documents/organizations/$(orgId)/members/$(request.auth.uid));
    }

    match /org-files/{orgId}/{projectSegment}/{fileName} {
      allow read, write: if isOrgMember(orgId);
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function ownsEmailDoc(email) {
      return signedIn() &&
        request.auth.token.email.lower() == email.lower();
    }

    function isAdmin() {
      return signedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid))
          .data.roles.hasAny(['beam-admin']);
    }

    function isMember(orgId) {
      return signedIn() &&
        exists(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid));
    }

    function isOrgAdmin(orgId) {
      return isMember(orgId) &&
        get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid))
          .data.role in ['owner', 'admin'];
    }

    function isOrgOwner(orgId) {
      return isMember(orgId) &&
        get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid))
          .data.role == 'owner';
    }

    match /users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow write: if signedIn() && request.auth.uid == uid;
    }

    match /clients/{email} {
      allow read: if ownsEmailDoc(email) || isAdmin();
      allow create: if ownsEmailDoc(email);
      allow update: if ownsEmailDoc(email) || isAdmin();
    }

    match /organizations/{orgId} {
      allow read: if isMember(orgId) || isAdmin();
      allow create: if signedIn();
      allow update: if isOrgAdmin(orgId) || isAdmin();
      allow delete: if isOrgOwner(orgId) || isAdmin();

      match /members/{uid} {
        allow read: if isMember(orgId) || isAdmin();
        allow write: if isOrgOwner(orgId) || isOrgAdmin(orgId) || isAdmin();
      }

      match /projects/{projectId} {
        allow read: if isMember(orgId) || isAdmin();
        allow write: if isOrgAdmin(orgId) || isAdmin();
      }

      match /files/{fileId} {
        allow read: if isMember(orgId) || isAdmin();
        allow create: if isMember(orgId) || isAdmin();
        allow update, delete: if isOrgAdmin(orgId) || isAdmin();
      }

      match /invites/{inviteId} {
        allow read: if isOrgAdmin(orgId) || isAdmin();
        allow write: if isOrgAdmin(orgId) || isAdmin();
      }
    }

    match /handoffs/{handoffId} {
      allow read: if signedIn();
      allow write: if false;
    }

    match /partners/{email} {
      allow read: if ownsEmailDoc(email) || isAdmin();
      allow write: if false;
    }

    match /projects/{projectId} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    match /ragNotes/{noteId} {
      allow read: if isAdmin() ||
        (resource.data.orgId is string && isMember(resource.data.orgId)) ||
        (resource.data.clientEmail is string && ownsEmailDoc(resource.data.clientEmail));
      allow write: if false;
    }

    match /mail/{mailId} {
      allow read, write: if false;
    }

    match /beam-users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow write: if signedIn() && request.auth.uid == uid;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
