# AeroSmart AI (Amadeus live search)

## Setup
1. Create a free Amadeus for Developers account and an app. Copy the API key and secret.
2. `npm i -g firebase-tools && firebase login`
3. Copy `.firebaserc.example` to `.firebaserc` and put in your Firebase project ID (Blaze plan needed for Functions).
4. `cd functions && npm install && cd ..`
5. `firebase functions:secrets:set AMADEUS_CLIENT_ID` and `firebase functions:secrets:set AMADEUS_CLIENT_SECRET`
6. `firebase deploy`

## Test vs production
Default host is `test.api.amadeus.com` (test data, limited routes and carriers).
For real market fares, request production access in the Amadeus portal, then create `functions/.env` containing `AMADEUS_HOST=api.amadeus.com` and set production keys as the secrets above.

## What Amadeus Self-Service does not provide
- Airlines selling only on their own sites or low-cost carriers outside the GDS are not returned.
- Search results have no refundable flag (needs the Flight Offers Price call) and no CO2 figure.
- The location search matches airport and city names and codes, not country names.
