CREATE TABLE `manualAssistanceRequests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`productId` int,
	`country` varchar(100) NOT NULL,
	`message` text NOT NULL,
	`status` enum('Pending','Reviewed','Resolved') NOT NULL DEFAULT 'Pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `manualAssistanceRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `adminAuditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` bigint unsigned NOT NULL,
	`entityType` varchar(60) NOT NULL,
	`entityId` varchar(80) NOT NULL,
	`action` varchar(100) NOT NULL,
	`previousValue` json,
	`newValue` json,
	`details` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adminAuditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `credentials_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `credentials_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `deposits` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`amountCents` int NOT NULL,
	`reference` varchar(160) NOT NULL DEFAULT '',
	`status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
	`processedBy` bigint unsigned,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deposits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`title` varchar(220) NOT NULL,
	`message` text NOT NULL,
	`read` boolean NOT NULL DEFAULT false,
	`soId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`manual` boolean NOT NULL DEFAULT false,
	`status` varchar(40) NOT NULL DEFAULT 'Pending',
	`totalCents` int NOT NULL,
	`shippingCents` int NOT NULL DEFAULT 0,
	`paymentMethod` varchar(50) NOT NULL,
	`address` text NOT NULL,
	`phone` varchar(50) NOT NULL,
	`country` varchar(100) NOT NULL,
	`items` json NOT NULL,
	`idempotencyKey` varchar(100),
	`refundIssued` boolean NOT NULL DEFAULT false,
	`stockRestored` boolean NOT NULL DEFAULT false,
	`createdBy` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_idempotency_idx` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int NOT NULL,
	`sku` varchar(80) NOT NULL,
	`name` varchar(300) NOT NULL,
	`brand` varchar(160) NOT NULL,
	`category` varchar(120) NOT NULL,
	`subcategory` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`priceCents` int NOT NULL,
	`mrpCents` int NOT NULL,
	`discountPercent` int NOT NULL,
	`stock` int NOT NULL,
	`image` text NOT NULL,
	`images` json NOT NULL,
	`data` json NOT NULL,
	`storeId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `referralCodes` (
	`code` varchar(9) NOT NULL,
	`createdBy` bigint unsigned NOT NULL,
	`usedBy` bigint unsigned,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referralCodes_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `sellerOrders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`customerOrderId` bigint unsigned NOT NULL,
	`storeId` bigint unsigned NOT NULL,
	`sellerId` bigint unsigned NOT NULL,
	`productId` int NOT NULL,
	`productName` varchar(300) NOT NULL,
	`productImage` text NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`amountCents` int NOT NULL,
	`profitCents` int NOT NULL DEFAULT 0,
	`status` varchar(50) NOT NULL DEFAULT 'Awaiting Acceptance',
	`eta` varchar(60) NOT NULL,
	`instructions` text,
	`history` json NOT NULL,
	`profitCredited` boolean NOT NULL DEFAULT false,
	`profitStatus` varchar(30) NOT NULL DEFAULT '',
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sellerOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `sellerOrders_customerOrderId_unique` UNIQUE(`customerOrderId`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`storeName` varchar(180) NOT NULL,
	`category` varchar(120) NOT NULL,
	`description` text NOT NULL,
	`gender` enum('Male','Female') NOT NULL,
	`country` varchar(100) NOT NULL,
	`dialingCode` varchar(8) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`docType` varchar(80) NOT NULL,
	`docImage` text,
	`refCode` varchar(9),
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`rejectReason` text,
	`creditScore` int NOT NULL DEFAULT 100,
	`rating` varchar(3) NOT NULL DEFAULT '5.0',
	`visitors` int NOT NULL DEFAULT 0,
	`views` int NOT NULL DEFAULT 0,
	`metricsSource` varchar(30) NOT NULL DEFAULT 'admin_configured',
	`ownerName` varchar(160),
	`houseNumber` varchar(40),
	`street` varchar(180),
	`apartment` varchar(80),
	`city` varchar(120),
	`state` varchar(120),
	`zip` varchar(30),
	`officeCountry` varchar(100),
	`productIds` json NOT NULL,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `stores_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`type` varchar(50) NOT NULL,
	`amountCents` bigint NOT NULL,
	`note` text NOT NULL,
	`orderId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`status` enum('active','banned') NOT NULL DEFAULT 'active',
	`referralCode` varchar(9),
	`referredBy` bigint unsigned,
	`referredAt` timestamp,
	`withdrawHold` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`userId` bigint unsigned NOT NULL,
	`balanceCents` bigint NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallets_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `withdrawals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`amountCents` int NOT NULL,
	`method` varchar(40) NOT NULL,
	`destination` text NOT NULL,
	`storeName` varchar(180) NOT NULL DEFAULT '',
	`status` enum('Pending','Completed','Rejected') NOT NULL DEFAULT 'Pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `withdrawals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `manualAssistanceRequests` ADD CONSTRAINT `manualAssistanceRequests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `adminAuditLogs` ADD CONSTRAINT `adminAuditLogs_adminId_users_id_fk` FOREIGN KEY (`adminId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credentials` ADD CONSTRAINT `credentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deposits` ADD CONSTRAINT `deposits_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deposits` ADD CONSTRAINT `deposits_processedBy_users_id_fk` FOREIGN KEY (`processedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referralCodes` ADD CONSTRAINT `referralCodes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD CONSTRAINT `sellerOrders_customerOrderId_orders_id_fk` FOREIGN KEY (`customerOrderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD CONSTRAINT `sellerOrders_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sellerOrders` ADD CONSTRAINT `sellerOrders_sellerId_users_id_fk` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `adminAuditLogs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `deposits_user_idx` ON `deposits` (`userId`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `products_store_idx` ON `products` (`storeId`);--> statement-breakpoint
CREATE INDEX `seller_orders_store_idx` ON `sellerOrders` (`storeId`);--> statement-breakpoint
CREATE INDEX `seller_orders_seller_idx` ON `sellerOrders` (`sellerId`);--> statement-breakpoint
CREATE INDEX `stores_status_idx` ON `stores` (`status`);--> statement-breakpoint
CREATE INDEX `stores_name_idx` ON `stores` (`storeName`);--> statement-breakpoint
CREATE INDEX `transactions_user_idx` ON `transactions` (`userId`);