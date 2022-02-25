// import * as functions from "firebase-functions";

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// The Cloud Functions for Firebase SDK to create
// Cloud Functions and set up triggers.

import * as functions from "firebase-functions";
// The Firebase Admin SDK to access Firestore.
import admin from "firebase-admin";

admin.initializeApp();
export const disableUser = functions.https.onCall((data, context) => {
  const uid = data.uid;
  admin.auth().updateUser(uid as string, {
    disabled: true,
  }).then((r) => console.log(`Successfully received: ${uid}`));
  return `Successfully received: ${uid}`;
});
export const enableUser = functions.https.onCall((data, context) => {
  const uid = data.uid;
  admin.auth().updateUser(uid as string, {
    disabled: false,
  }).then((r) => console.log(`Successfully received: ${uid}`));
  return `Successfully received: ${uid}`;
});

// Take the text parameter passed to this HTTP endpoint and insert it into
// Firestore under the path /messages/:documentId/original
export const addMessage = functions.https.onRequest(async (req, res) => {
  // Grab the text parameter.
  const original = req.query.text;
  // Push the new message into Firestore using the Firebase Admin SDK.
  const writeResult = await admin.firestore()
      .collection("messages").add({original: original});
  // Send back a message that we've successfully written the message
  res.json({result: `Message with ID: ${writeResult.id} added.`});
});

// Listens for new messages added to /messages/:documentId/original
// and creates an uppercase version of the message
// to /messages/:documentId/uppercase
// eslint-disable-next-line max-len
export const makeUppercase = functions.firestore.document("/users/{documentId}")
    .onCreate((snap, context) => {
      // Grab the current value of what was written to Firestore.
      const original = snap.data().name;

      // Access the parameter `{documentId}` with `context.params`
      functions.logger.log("Uppercasing", context.params.documentId, original);

      const uppercase = original.toUpperCase();

      // You must return a Promise when performing asynchronous
      // tasks inside a Functions such as writing to Firestore.
      // Setting an 'uppercase' field in Firestore document returns a Promise.
      return snap.ref.set({uppercase}, {merge: true});
    });

export const sendNotificationOnCreateTransaction = functions.firestore
    .document("/bridges/{documentId}/transactions/{transactionId}")
    .onCreate(async (snap, context) => {
      const transaction = snap.data();
      const createdBy = transaction.createdBy;
      functions.logger.log("transactionId:", context.params.transactionId);
      functions.logger.log("transaction createdBy:", createdBy);
      functions.logger.log("transaction note:", transaction.note);

      functions.logger.log("BridgeId:", context.params.documentId);
      const bridge = await admin.firestore()
          .collection("bridges")
          .doc(context.params.documentId)
          .get();

      const transactionCreatorIsBridgeOwner =
          bridge.data()?.creator === createdBy;

      let typeOfTransaction = "";

      // Signs are reversed according to normal convention
      if (transaction.amount < 0) {
        typeOfTransaction = "Debit";
      } else if (transaction.amount > 0) {
        typeOfTransaction = "Credit";
      }

      const userIdToBeNotified = transactionCreatorIsBridgeOwner ?
            bridge.data()?.acceptor :
            bridge.data()?.creator;

      functions.logger.log("userIdToBeNotified:", userIdToBeNotified);

      const userToBeNotified = await admin.firestore()
          .collection("users")
          .doc(userIdToBeNotified)
          .get();

      const userData = userToBeNotified.data();
      if (userData?.tokens.length == 0) {
        functions.logger.log(`The user: ${userToBeNotified.id} is not logged in`);
        return;
      }

        userData?.tokens
            .forEach((token: string) => functions.logger.log("token:", token));

        const transactionCreator = (await admin.firestore()
            .collection("users")
            .doc(createdBy)
            .collection("accounts")
            .doc(userToBeNotified.id)
            .get()).data();
        // @TODO: should we fetch the transactionCreator
        //  from the receiving user's accounts?
        // That way the name will be according to the receiving user
        let notification = {};

        if (typeOfTransaction === "" && transaction.note !== "") {
          notification = {
            title: `${transactionCreator?.name} sent a note`,
            body: `${transaction.note}`,
          };
        } else {
          notification = {
            title: `${typeOfTransaction} Transaction Request`,
            // eslint-disable-next-line max-len
            body: `From ${transactionCreator?.name} for ${Math.abs(transaction.amount)}`,
          // imageUrl: "https://my-cdn.com/extreme-weather.png",
          };
        }
        functions.logger.log("Bridge Creator:", bridge.data()?.creator);
        functions.logger.log("Bridge Acceptor:", bridge.data()?.acceptor);

        await admin.messaging().sendToDevice(
          userData?.tokens, // ['token_1', 'token_2', ...]
          {
            data: {
              owner: "JSON.stringify(owner)",
              user: "JSON.stringify(user)",
              // picture: JSON.stringify(picture),
            },
            notification: notification,
          },
          {
            // restrictedPackageName: '<ledgerlivePackageName>',
            // Required for background/quit data-only messages on iOS
            contentAvailable: true,
            // Required for background/quit data-only messages on Android
            priority: "high",
          }
        );
      //
      // await admin.messaging().sendMulticast({
      //   tokens: userData?.tokens,
      //   notification: {
      //     title: "Weather Warning!",
      //     body: "A new weather warning has been issued for your location.",
      //     imageUrl: "https://my-cdn.com/extreme-weather.png",
      //   },
      // });
    });

export const sendNotificationOnTransactionStatusChange = functions.firestore
    .document("/bridges/{documentId}/transactions/{transactionId}")
    .onUpdate(async (change, context) => {
      const prevTransaction = change.before.data();
      const transaction = change.after.data();
      if (prevTransaction.status != transaction.status && transaction.status != "pending") {
        const transactionCreatedBy = transaction.createdBy;
        const userIdToBeNotified = transactionCreatedBy;
        const bridge = await admin.firestore()
            .collection("bridges")
            .doc(context.params.documentId)
            .get();

        const transactionCreatorIsBridgeOwner =
            bridge.data()?.creator === transactionCreatedBy;

        const acceptorUserId = transactionCreatorIsBridgeOwner ?
            bridge.data()?.acceptor :
            bridge.data()?.creator;

        const userToBeNotified = await admin.firestore()
            .collection("users")
            .doc(userIdToBeNotified)
            .get();

        const userData = userToBeNotified.data();
        if (userData?.tokens.length == 0) {
          functions.logger.log(`The user: ${userToBeNotified.id} is not logged in`);
          return;
        }

        const transactionAcceptor = (await admin.firestore()
            .collection("users")
            .doc(userToBeNotified.id)
            .collection("accounts")
            .doc(acceptorUserId)
            .get()).data();
          // @TODO: should we fetch the transactionCreator
          //  from the receiving user's accounts?
          // That way the name will be according to the receiving user

        const notification = {
          title: `Transaction ${transaction.status}`,
          // eslint-disable-next-line max-len
          body: `${transactionAcceptor?.name} has ${transaction.status} your transaction`,
          // imageUrl: "https://my-cdn.com/extreme-weather.png",
        };
        await admin.messaging().sendToDevice(
              userData?.tokens, // ['token_1', 'token_2', ...]
              {
                data: {
                  owner: "JSON.stringify(owner)",
                  user: "JSON.stringify(user)",
                  // picture: JSON.stringify(picture),
                },
                notification: notification,
              },
              {
                // restrictedPackageName: '<ledgerlivePackageName>',
                // Required for background/quit data-only messages on iOS
                contentAvailable: true,
                // Required for background/quit data-only messages on Android
                priority: "high",
              }
        );
      }
    });

export const sendNotificationOnConnectionRequest = functions.firestore
    .document("/bridges/{documentId}")
    .onCreate(async (snap, context) => {
      const bridge = snap.data();

      const bridgeCreator = (await admin.firestore()
          .collection("users")
          .doc(bridge.creator)
          .get()).data();

      const userIdToBeNotified = bridge.acceptor;
      const userToBeNotified = (await admin.firestore()
          .collection("users")
          .doc(userIdToBeNotified)
          .get()).data();

      if (userToBeNotified?.tokens.length == 0) {
        functions.logger.log(`The user: ${userToBeNotified.id} is not logged in`);
        return;
      }
      await admin.messaging().sendToDevice(
          userToBeNotified?.tokens, // ['token_1', 'token_2', ...]
          {
            data: {
              owner: "JSON.stringify(owner)",
              user: "JSON.stringify(user)",
              // picture: JSON.stringify(picture),
            },
            notification: {
              title: "New Connection Request",
              // eslint-disable-next-line max-len
              body: `From ${bridgeCreator?.name} | ${bridgeCreator?.email}`,
            },
          },
          {
            // restrictedPackageName: '<ledgerlivePackageName>',
            // Required for background/quit data-only messages on iOS
            contentAvailable: true,
            // Required for background/quit data-only messages on Android
            priority: "high",
          }
      );
    });

export const sendNotificationOnConnectionAcceptance = functions.firestore
    .document("/bridges/{documentId}")
    .onUpdate(async (change, context) => {
      const prevBridge = change.before.data();
      const bridge = change.after.data();

      if (prevBridge.status != bridge.status) {
        const requestAcceptorId = bridge.acceptor;
        const requestAcceptor = (await admin.firestore()
            .collection("users")
            .doc(requestAcceptorId)
            .get()).data();
        const bridgeCreator = (await admin.firestore()
            .collection("users")
            .doc(bridge.creator)
            .get()).data();
        //
        // const userIdToBeNotified = bridge.acceptor;
        // const userToBeNotified = (await admin.firestore()
        //     .collection("users")
        //     .doc(userIdToBeNotified)
        //     .get()).data();

        await admin.messaging().sendToDevice(
          bridgeCreator?.tokens, // ['token_1', 'token_2', ...]
          {
            data: {
              owner: "JSON.stringify(owner)",
              user: "JSON.stringify(user)",
              // picture: JSON.stringify(picture),
            },
            notification: {
              title: "Request Accepted",
              // eslint-disable-next-line max-len
              body: `By ${requestAcceptor?.name} | ${requestAcceptor?.email}`,
            },
          },
          {
            // restrictedPackageName: '<ledgerlivePackageName>',
            // Required for background/quit data-only messages on iOS
            contentAvailable: true,
            // Required for background/quit data-only messages on Android
            priority: "high",
          }
        );
      }
    });

