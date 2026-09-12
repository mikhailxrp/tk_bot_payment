-- CreateTable
CREATE TABLE `GroupActivity` (
    `userId` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GroupActivity` ADD CONSTRAINT `GroupActivity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

