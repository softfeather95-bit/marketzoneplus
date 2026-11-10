ALTER TABLE `sellerOrders` ADD `deductedCents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD `returnedCents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD `balanceAfterDebitCents` int;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD `balanceAfterCompletionCents` int;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD `acceptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD `completedAt` timestamp;