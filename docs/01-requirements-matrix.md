# GameHub Functional Requirements

| CODE | Functional Requirement |
|---|---|
| AD-001 | Administrator should be able to log in to the GameHub system. |
| AD-002 | Administrator should be able to log out of the GameHub system. |
| AD-003 | Administrator should be able to approve cashiers personal email application. |
| AD-004 | Administrator should be able to view cashier accounts. |
| AD-005 | Administrator should be able to update cashier account information. |
| AD-006 | Administrator should be able to archive cashier accounts. |
**| AD-007 | Administrator should be able to unarchive cashiers account |**
**| AD-008 | Administrator should be able to unarchive billiard tables |**
**| AD-009 | Administrator should be able to add billiard tables. |**
**| AD-010 | Administrator should be able to rename billiard tables. |**
**| AD-011 | Administrator should be able to archive billiard tables. |**
**| AD-012 | Administrator should be able to configure table maintenance status. |**
**| AD-013 | Administrator should be able to view current table statuses. |**
**| AD-014 | Administrator should be able to view active customer sessions. |**
| AD-015 | Administrator should be able to view customer and transaction information relevant to current operations. |
| AD-016 | Administrator should be able to configure regular hourly table rates. |
| AD-017 | Administrator should be able to configure special hourly table rates. |
| AD-018 | Administrator should be able to update table rates with an effective date/time. |
| AD-019 | Administrator should be able to view daily income reports. |
| AD-020 | Administrator should be able to view monthly income reports. |
| AD-021 | Administrator should be able to view table usage reports. |
| AD-022 | Administrator should be able to view total playing-hours reports. |
| AD-023 | Administrator should be able to filter reports by a selected date range. |
| AD-024 | Administrator should be able to export reports. |
| AD-025 | Administrator should be able to view transaction records. |
| AD-026 | Administrator should be able to view activity logs for important system and operational actions. |
| AD-027 | Administrator should be able to view customer session history. |
| AD-028 | Administrator should be able to view reservations. |
| AD-029 | Administrator should be able to update reservation information. |
| AD-030 | Administrator should be able to cancel reservations. |
| AD-031 | Administrator should be able to add food and beverage products. |
| AD-032 | Administrator should be able to update food and beverage product information and prices. |
| AD-033 | Administrator should be able to archive food and beverage products. |
| AD-034 | Administrator should be able to manage API integrations. |
| AD-035 | Administrator should be able to view their profile. |
| AD-036 | Administrator should be able to switch between light and dark mode from the settings menu. |
| AD-037 | Administrator should be able to log out from the settings menu. |


-----------------------------------------------------------------------------------------------------


|CA-001.1| Cashier should be able to create an account using their personal email.
| CA-001 | Cashier should be able to log in to the GameHub system using personal email. |
| CA-002 | Cashier should be able to log out of the GameHub system. |
| CA-003 | Cashier should be able to view current table statuses. |
| CA-004 | Cashier should be able to view active customer sessions. |
| CA-005 | Cashier should be able to view customer and transaction information relevant to current operations. |
| CA-006 | Cashier should be able to start a customer playing session for an available table. |
| CA-007 | Cashier should be able to start a walk-in customer session without a prior reservation. |
| CA-008 | Cashier should be able to start a session for a checked-in reservation. |
| CA-009 | Cashier should be able to extend an active customer session. |
| CA-010 | Cashier should be able to view the running session timer. |
| CA-011 | Cashier should be able to end an active customer session. |
| CA-012 | Cashier should be able to cancel or void an incorrectly created session when authorized. |
| CA-013 | Cashier should be able to view session details and session history. |
| CA-014 | System should automatically calculate the session charge based on the actual session duration and the applicable table rate, using per-minute billing. |
| CA-015 | Cashier should be able to check in a customer with a valid reservation. |
| CA-016 | Cashier should be able to view reservation details needed for check-in. |
| CA-017 | Cashier should be able to view tables categorized as Available, Occupied, Reserved, or Under Maintenance. |
| CA-018 | Cashier should be able to update operational table status between Available and Occupied as part of normal cashier operations. |
| CA-019 | Cashier should be able to view applicable table rates. |
| CA-020 | Cashier should be able to create a customer bill containing applicable session charges and F&B orders. |
| CA-021 | Cashier should be able to record customer payments. |
| CA-022 | Cashier should be able to record the payment method and amount received. |
| CA-023 | System should calculate and display change when the amount received exceeds the bill total. |
| CA-024 | System should generate a unique transaction reference for a completed payment. |
| CA-025 | Cashier should be able to generate or print a customer receipt. |
| CA-026 | Cashier should be able to view available food and beverage products and prices. |
| CA-027 | Cashier should be able to add food and beverage items to a customer's bill. |
| CA-028 | Cashier should be able to update or remove unfinalized F&B items from a customer's bill. |
| CA-032 | Cashier should be able to start and end a duty shift. |
| CA-033 | System should record important cashier actions such as session start/end, payment recording, reservation check-in, and authorized corrections. |


-----------------------------------------------------------------------------------------------------


| CU-001 | Customer should be able to view information about the GameHub establishment and its services. |
| CU-002 | Customer should be able to view currently available tables. |
| CU-003 | Customer should be able to view applicable table rates. |
| CU-004 | Customer should be able to select a preferred table, reservation date, and reservation time. |
| CU-005 | Customer should be able to provide the name and contact number required for a reservation. |
| CU-006 | Customer should be able to review reservation details before confirmation. |
| CU-007 | Customer should be able to confirm a reservation. |
| CU-008 | System should prevent overlapping reservations for the same table and time period. |
| CU-009 | System should validate that the selected reservation date and time are valid and available. |
| CU-010 | System should generate a unique reservation reference number after a successful reservation. |
| CU-011 | Customer should be able to view an existing reservation using its reservation reference and required contact information. |
| CU-012 | Customer should be able to cancel an existing reservation at any time before the scheduled reservation time. |
| CU-013 | Customer should receive an on-screen reservation confirmation containing the reservation reference and reservation details. |
| CU-014 | Customer should be informed when a reservation cannot be completed because the selected table/time is unavailable. |
| CU-015 | Customer accounts are not required; customers use GameHub as guests without registration or login. |