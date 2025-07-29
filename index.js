require("dotenv").config({
  quiet: true,
});
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  EmbedBuilder,
  ButtonBuilder,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  AuditLogEvent,
  AttachmentBuilder,
  MessageManager,
  // GatewayActivityEmoji, // no longer needed
} = require("discord.js");
const mathjs = require("mathjs"); // worse math processor but worked for a while :P
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3"); // ew sql
// const { wordsToNumbers } = require("words-to-numbers"); // ts pmo i HATE THIS PACKAGE
const { default: mathEval } = require("./mathEval"); // thank uu null <3

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const COUNTING_CHANNEL_ID = process.env.COUNTING_CHANNEL_ID;
const NUMBER_FILE = path.join(__dirname, "number.txt");
const MODMAIL_CATEGORY_ID = process.env.MODMAIL_CATEGORY_ID; // replace with your modmail category ID
const STATUSES_ENABLED = process.env.STATUSES_ENABLED === "true" || false; // enable or disable statuses
const STARBOARD_CHANNEL_ID = process.env.STARBOARD_CHANNEL_ID;
const STARBOARD_MINIMUM = process.env.STARBOARD_MINIMUM;

const db = new Database(path.join(__dirname, "database.db"));
// const dbStar = new Database(path.join(__dirname, "starboard.db"));

let countState = {
  currentNum: 0,
  bestNum: 0,
  lastUserId: "",
  lastSaved: 0,
};

// Create table if not exists
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    moderator TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )
`
).run();

// and the starboard one
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS starboard (
    message_id TEXT PRIMARY KEY,
    starboard_message_id TEXT NOT NULL,
    starred_at TEXT
  )
`
).run();

// aaaaaand the leveling one
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS levels (
    user_id TEXT,
    guild_id TEXT,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, guild_id)
  )
`
).run();

// create number.txt if not exists
if (!fs.existsSync(NUMBER_FILE)) {
  fs.writeFileSync(NUMBER_FILE, "0\n0\n", "utf8");
}

try {
  const lines = fs.readFileSync(NUMBER_FILE, "utf8").trim().split("\n");
  countState.currentNum = parseInt(lines[0]) || 0;
  countState.bestNum = parseInt(lines[1]) || 0;
  countState.lastUserId = lines[2] || "";
} catch {
  countState = {
    currentNum: 0,
    bestNum: 0,
    lastUserId: "",
    lastSaved: Date.now(),
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [
    Partials.User,
    Partials.Channel,
    Partials.GuildMember,
    Partials.GuildScheduledEvent,
    Partials.Message,
    Partials.Reaction,
  ],
});

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Sends the help message!")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number").setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("source")
    .setDescription("Sends the source code of the bot!"),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a user (admin only)")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to warn").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason for warning")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show warnings for a user")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to check").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("purge")
    .setDescription(
      "Delete a number of messages from this channel (admin only)"
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Number of messages to delete (max 100)")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Shows your current level and XP.")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to check.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Shows the top 10 users in this server by level."),
  // user select menu interaction
  new ContextMenuCommandBuilder()
    .setName("Start ModMail Conversation")
    .setType(ApplicationCommandType.User),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Slash command registered.");
  } catch (error) {
    console.error(error);
  }
})();

let activityIndex = 0;
const activity = [
  {
    type: ActivityType.Listening,
    name: "your DMs",
  },
  {
    type: ActivityType.Watching,
    name: `over %memberCount% members`,
  },
  {
    type: ActivityType.Playing,
    name: "around with code",
  },
  {
    type: ActivityType.Competing,
    name: `counting (at %countingNum%)`,
  },
  {
    type: ActivityType.Custom,
    name: "/help | Running GrassCat v1",
  },
];

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // get the status of a user (for debugging)
  // const user = await client.users
  //   .fetch("1382458139470860338")
  //   .catch(() => null);
  // console.log(user);
  // // log users custom status data
  // console.log(user.presence);
  // console.log("tried");

  await client.user.setPresence({
    activities: [{ type: ActivityType.Custom, name: "running grasscat v1!" }],
    status: "online",
  });

  // initial run
  if (STATUSES_ENABLED) {
    try {
      let activityData = activity[activityIndex];
      activityData.name = activityData.name
        .replace(
          "%memberCount%",
          client.guilds.cache.get(GUILD_ID).memberCount.toString()
        )
        .replace("%countingNum%", countState.currentNum.toString());
      console.log(activityData);
      client.user.setPresence({
        activities: [activityData],
        status: "online",
      });
      activityIndex++;
    } catch (error) {
      console.error("Failed to fetch guild members:", error);
      client.user.setPresence({
        activities: [
          { name: "Failed to fetch members!", type: ActivityType.Playing },
        ],
        status: "idle",
      });
    }
  }
  try {
    const countingChannel = await client.channels.fetch(COUNTING_CHANNEL_ID);
    // Read current number and best streak from number.txt
    let currentNum = 0,
      bestNum = 0;
    try {
      const lines = fs.readFileSync(NUMBER_FILE, "utf8").trim().split("\n");
      currentNum = parseInt(lines[0]);
      bestNum = parseInt(lines[1]);
      if (isNaN(currentNum)) currentNum = 0;
      if (isNaN(bestNum)) bestNum = 0;
    } catch {
      currentNum = 0;
      bestNum = 0;
    }
    await countingChannel.setTopic(
      `Count with the other members! | Next number: ${
        currentNum + 1
      } | Highest number: ${bestNum}\nNumbers may be wrong as the status takes a while to update!\nLast updated: ${new Date().toLocaleString()}`
    );
  } catch (err) {
    console.error("Failed to update counting channel topic:", err);
  }
  // and then the interval
  setInterval(async () => {
    try {
      const countingChannel = await client.channels.fetch(COUNTING_CHANNEL_ID);
      // Read current number and best streak from number.txt
      let currentNum = 0,
        bestNum = 0;
      try {
        const lines = fs.readFileSync(NUMBER_FILE, "utf8").trim().split("\n");
        currentNum = parseInt(lines[0]);
        bestNum = parseInt(lines[1]);
        if (isNaN(currentNum)) currentNum = 0;
        if (isNaN(bestNum)) bestNum = 0;
      } catch {
        currentNum = 0;
        bestNum = 0;
      }
      await countingChannel.setTopic(
        `Count with the other members! | Next number: ${
          currentNum + 1
        } | Highest number: ${bestNum}\nNumbers may be wrong as the status takes a while to update!\nLast updated: ${new Date().toLocaleString()}`
      );
    } catch (err) {
      console.error("Failed to update counting channel topic:", err);
    }
  }, 600_000); // Update every 10 minutes

  if (STATUSES_ENABLED) {
    setInterval(async () => {
      try {
        let activityData = activity[activityIndex];
        activityData.name = activityData.name
          .replace(
            "%memberCount%",
            client.guilds.cache.get(GUILD_ID).memberCount.toString()
          )
          .replace("%countingNum%", countState.currentNum.toString());
        console.log(activityData);
        client.user.setPresence({
          activities: [activityData],
          status: "online",
        });
        activityIndex++;
      } catch (error) {
        console.error("Failed to update presence:", error);
        client.user.setPresence({
          activities: [
            { name: "Failed to update presence!", type: ActivityType.Playing },
          ],
          status: "idle",
        });
      }
      if (activityIndex >= activity.length) {
        activityIndex = 0; // Reset index if it exceeds the length
      }
    }, 5_000); // Update presence every 5 seconds
  }
});

// Help menu class
class HelpMenu {
  constructor(data) {
    this.pages = data.pages;
    this.flags = data.flags;
  }

  generateEmbed(pageIndex) {
    const pageData = this.pages[pageIndex] || [];
    const embed = new EmbedBuilder()
      // .setTitle("grasscat help")
      .setAuthor({
        name: "grasscat help",
        iconURL:
          "https://cdn.discordapp.com/avatars/1176276008773615737/cef9b6f2c44841e40a5436cc74d1a1c3.webp?size=1024",
      })
      .setFooter({ text: `Page ${pageIndex + 1}/${this.pages.length}` })
      .setTimestamp()
      .setColor(0x383a40);

    pageData.forEach((cmd) => {
      const flagText = cmd.flag.map((f) => `**${this.flags[f]}**`).join(" ");
      embed.addFields({
        name: cmd.name,
        value: `${cmd.desc}\n${flagText}`,
        inline: true,
      });
    });

    return embed;
  }

  createButtons(currentPage) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),

      new ButtonBuilder()
        .setCustomId("next")
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === this.pages.length - 1)
    );
  }

  handlePagination(interaction, userId, currentPage) {
    const message = interaction.reply({
      embeds: [this.generateEmbed(currentPage)],
      components: [this.createButtons(currentPage)],
      fetchReply: true,
    });

    message.then((sentMessage) => {
      const collector = sentMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 60_000,
      });

      collector.on("collect", async (i) => {
        i.deferUpdate();
        if (i.customId === "next" && currentPage < this.pages.length - 1) {
          currentPage++;
        } else if (i.customId === "prev" && currentPage > 0) {
          currentPage--;
        }

        await interaction.editReply({
          embeds: [this.generateEmbed(currentPage)],
          components: [this.createButtons(currentPage)],
        });
      });

      collector.on("end", () => {
        interaction.editReply({
          content: "message interaction window expired.",
          components: [],
        });
      });
    });
  }
}

const helpData = JSON.parse(fs.readFileSync("help.json", "utf-8"));

// Handle interactions
client.on("interactionCreate", async (interaction) => {
  // if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
  }

  if (interaction.commandName === "help") {
    const pageInput = interaction.options.getInteger("page") || 1;
    const helpMenu = new HelpMenu(helpData);
    let currentPage = Math.max(
      0,
      Math.min(pageInput - 1, helpData.pages.length - 1)
    );

    helpMenu.handlePagination(interaction, interaction.user.id, currentPage);
  }

  if (interaction.commandName === "source") {
    await interaction.reply({
      content: "<https://git.tomcat.sh/grasscat>",
      files: [
        new AttachmentBuilder(
          "https://github.com/tomcqt/grasscat/archive/refs/heads/master.zip",
          { name: "source.zip" }
        ),
      ],
    });
  }

  if (interaction.commandName === "warn") {
    // Check for administrator permission
    if (!interaction.member.permissions.has("Administrator")) {
      await interaction.reply({
        content: "You need to be an administrator to use this command.",
        ephemeral: true,
      });
      return;
    }

    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const moderator = interaction.user;

    // Save to DB
    db.prepare(
      "INSERT INTO warnings (user, moderator, reason, timestamp) VALUES (?, ?, ?, ?)"
    ).run(user.id, moderator.id, reason, Date.now());

    // Calculate warn points
    const rows = db
      .prepare("SELECT COUNT(*) AS count FROM warnings WHERE user = ?")
      .get(user.id);
    const warnPoints = rows.count * 50;

    // Create embed for DM
    const dmEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`You have been warned in ${interaction.guild.name}`)
      .setDescription(
        `**Reason:** ${reason}\n**Warn Points:** ${warnPoints}/250`
      )
      .setFooter({ text: `Moderator: ${moderator.tag}` })
      .setTimestamp();

    // DM the user
    try {
      await user.send({ embeds: [dmEmbed] });
    } catch {
      // Ignore if DMs are closed
    }

    // Ban if points >= 250
    if (warnPoints >= 250) {
      try {
        // dm the user
        await user.send({
          content: `You have been banned from ${interaction.guild.name} for reaching ${warnPoints} warn points.`,
        });
        // send a list of their warns
        const warnRows = db
          .prepare(
            "SELECT * FROM warnings WHERE user = ? ORDER BY timestamp DESC"
          )
          .all(user.id);
        const warnList = warnRows
          .map(
            (row, i) =>
              `**${i + 1}.** *${new Date(
                row.timestamp
              ).toLocaleString()}* by <@${row.moderator}>\n> ${row.reason}`
          )
          .join("\n\n");
        await user.send({
          content: `Here are your warnings:\n\n${warnList}`,
        });
        // ban the user
        await interaction.guild.members.ban(user.id, {
          reason: `Reached ${warnPoints} warn points.`,
        });
        await interaction.reply({
          content: `User <@${user.id}> has been banned for reaching ${warnPoints} warn points.`,
          allowedMentions: { users: [user.id] },
          ephemeral: false,
        });
      } catch (err) {
        await interaction.reply({
          content: `Failed to ban <@${user.id}>. I may not have permission.`,
          allowedMentions: { users: [user.id] },
          ephemeral: true,
        });
      }
      return;
    }

    // Create embed for chat confirmation
    const chatEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`Warned ${user.tag}`)
      .setDescription(
        `**Reason:** ${reason}\n**Warn Points:** ${warnPoints}/250`
      )
      .setFooter({ text: `Moderator: ${moderator.tag}` })
      .setTimestamp();

    // Send confirmation embed and auto-delete after 5 seconds
    await interaction.reply({
      embeds: [chatEmbed],
      allowedMentions: { users: [user.id] },
      fetchReply: true,
    });
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 5000);
  }

  if (interaction.commandName === "warnings") {
    const user = interaction.options.getUser("user");
    const rows = db
      .prepare("SELECT * FROM warnings WHERE user = ? ORDER BY timestamp DESC")
      .all(user.id);

    const warnCount = rows.length;
    const warnPoints = warnCount * 50;

    if (warnCount === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Warnings for ${user.tag}`)
        .setDescription("No warnings found.");
      await interaction.reply({
        embeds: [embed],
        allowedMentions: { users: [user.id] },
      });
    } else {
      const embed = new EmbedBuilder()
        .setColor(0xedc531)
        .setTitle(`Warnings for ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**Total warnings:** ${warnCount}\n**Warn Points:** ${warnPoints}/250\n\n` +
            rows
              .map(
                (row, i) =>
                  `**${i + 1}.** *${new Date(
                    row.timestamp
                  ).toLocaleString()}* by <@${row.moderator}>\n> ${row.reason}`
              )
              .join("\n\n")
        );
      await interaction.reply({
        embeds: [embed],
        allowedMentions: { users: [user.id] },
      });
    }
  }

  if (interaction.commandName === "purge") {
    // Check for administrator permission
    if (!interaction.member.permissions.has("Administrator")) {
      await interaction.reply({
        content: "You need to be an administrator to use this command.",
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getInteger("amount");

    if (amount < 1 || amount > 100) {
      await interaction.reply({
        content: "Amount must be between 1 and 100.",
        ephemeral: true,
      });
      return;
    }

    // Delete messages
    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    await interaction.channel.bulkDelete(fetched);

    await interaction.reply({
      content: `Deleted ${fetched.size} messages.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "rank") {
    const user = interaction.options.getUser("user") || interaction.user;
    const guildId = interaction.guild.id;

    const data = db
      .prepare(
        `
    SELECT * FROM levels WHERE user_id = ? AND guild_id = ?
  `
      )
      .get(user.id, guildId);

    if (!data) {
      await interaction.reply({
        content: `${user.username} has no level data yet.`,
        ephemeral: true,
      });
      return;
    }

    const nextLevelXp = data.level * 100;

    await interaction.reply({
      embeds: [
        {
          title: `${user.username}'s Rank`,
          color: 0x00bfff,
          fields: [
            { name: "Level", value: `${data.level}`, inline: true },
            { name: "XP", value: `${data.xp}/${nextLevelXp}`, inline: true },
          ],
          thumbnail: { url: user.displayAvatarURL() },
        },
      ],
    });
  }

  if (interaction.commandName === "top") {
    const guildId = interaction.guild.id;

    const topUsers = db
      .prepare(
        `
    SELECT user_id, level, xp FROM levels
    WHERE guild_id = ?
    ORDER BY level DESC, xp DESC
    LIMIT 10
  `
      )
      .all(guildId);

    if (topUsers.length === 0) {
      await interaction.reply("No one has any XP yet!");
      return;
    }

    const leaderboard = await Promise.all(
      topUsers.map(async (u, i) => {
        const user = await interaction.client.users
          .fetch(u.user_id)
          .catch(() => null);
        const name = user?.username || "Unknown User";
        return `**${i + 1}.** ${name.replace("_", "\\_")} — Level ${u.level}, ${
          u.xp
        } XP`;
      })
    );

    await interaction.reply({
      embeds: [
        {
          title: "🏆 Top 10 Users",
          description: leaderboard.join("\n"),
          color: 0xffd700,
        },
      ],
    });
  }

  // modmail!
  if (interaction.isUserContextMenuCommand()) {
    // console.log("got this!");
    if (interaction.commandName === "Start ModMail Conversation") {
      // console.log("thing!");
      // Check for administrator permission
      if (!interaction.member.permissions.has("Administrator")) {
        await interaction.reply({
          content: "You need to be an administrator to use this command.",
          ephemeral: true,
        });
        return;
      }

      const user = interaction.targetUser;

      // create channel
      const guild = await client.guilds.fetch(GUILD_ID);
      const dmChannelName = `dm-${user.id}`;
      let dmChannel = guild.channels.cache.find(
        (ch) => ch.name === dmChannelName && ch.type === ChannelType.GuildText
      );
      if (!dmChannel) {
        // Create the channel if it doesn't exist and put it under the "ModMail" category
        dmChannel = await guild.channels.create({
          name: dmChannelName,
          type: ChannelType.GuildText,
          parent: MODMAIL_CATEGORY_ID, // this already is private
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionsBitField.Flags.ViewChannel], // Deny view for everyone by default
            },
            {
              id: "1391401986598899712",
              allow: [PermissionsBitField.Flags.ViewChannel],
            },
          ],
        });
      }
      await interaction.reply({
        content: `Channel created or found successfully! <#${dmChannel.id}>`,
        ephemeral: true,
      });
      const dmChannelEmbed = new EmbedBuilder()
        .setColor(0x57f287) // green
        .setTitle("ModMail with " + user.displayName)
        .setDescription(
          `This channel is for DMs with <@${user.id}>.\nYou can send messages here to DM them.\nPress the button on this message to delete the channel.`
        )
        .setTimestamp();
      const pinnedMessage = await dmChannel.send({
        content: `Channel Info`,
        embeds: [dmChannelEmbed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("delete_dm_channel")
              .setLabel("Delete Channel")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });
      // pin the message
      await pinnedMessage.pin().catch(() => {
        console.error("Failed to pin the DM channel message.");
      });
    }
  }
});

client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // silly message forwarding through "<message>"
  if (
    message.content.startsWith("<") &&
    message.content.endsWith(">") &&
    message.author.id === "1059605055411601429"
  ) {
    // const finalMessage = message.content.slice(1, -1);
    await message.delete();
    if (message.reference) {
      const original = await message.channel.messages.fetch(
        message.reference.messageId
      );
      await original.reply(message.content.slice(1, -1));
    } else {
      await message.channel.send(message.content.slice(1, -1));
    }
  }

  // Check if the bot is mentioned
  if (
    message.mentions.has(client.user) &&
    message.content.contains(CLIENT_ID)
  ) {
    // only pings, not replies
    // Your response or logic here
    const sillyMessage = await message.reply({
      content:
        `## hey there, i'm <@${client.user.id}>!\n` +
        " i manage this server and can help you with certain things!\n" +
        "- if you need help, you can do `/help` to see what i can do, or press the button below.\n" +
        "- if you want to see my source code, you can do `/source`.\n" +
        "-# :3 (written by <@1059605055411601429>)\n" +
        "you can react with :x: to delete this message.",
      allowedMentions: { repliedUser: false },
    });
    // react with :x:
    await sillyMessage.react("❌");
    // delete message when the pinger reacts with :x:
    const filter = (reaction, user) =>
      reaction.emoji.name === "❌" &&
      !user.bot &&
      user.id === message.author.id;
    const collector = sillyMessage.createReactionCollector({
      filter,
      time: 600_000, // 10 minutes
    });
    collector.on("collect", async (reaction, user) => {
      if (user.id === message.author.id) {
        await sillyMessage.delete().catch(() => {});
        // await message.delete().catch(() => {}); // dont delete the original message (just in case its like an announcement or smth idk)
      } else {
        // send a message saying you can't delete this message
        await message.channel.send({
          content: `You can't delete this message! Only <@${message.author.id}> can.`,
          allowedMentions: { users: [user.id] },
          ephemeral: true,
        });
      }
    });
  }

  // dms
  if (!message.guild) {
    // console.log("caught dm");
    // send message to dm channel or create one then send if it doesnt exist
    const guild = await client.guilds.fetch(GUILD_ID);
    const dmChannelName = `dm-${message.author.id}`;
    let dmChannel = guild.channels.cache.find(
      (ch) => ch.name === dmChannelName && ch.type === ChannelType.GuildText
    );
    if (!dmChannel) {
      // Create the channel if it doesn't exist and put it under the "ModMail" category
      dmChannel = await guild.channels.create({
        name: dmChannelName,
        type: ChannelType.GuildText,
        parent: MODMAIL_CATEGORY_ID, // this already is private
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel], // Deny view for everyone by default
          },
        ],
      });

      // channel creation message
      const dmChannelEmbed = new EmbedBuilder()
        .setColor(0x57f287) // green
        .setTitle("ModMail with " + message.author.displayName)
        .setDescription(
          `This channel is for DMs with <@${message.author.id}>.\nYou can send messages here to DM them.\nPress the button on this message to delete the channel.`
        )
        .setTimestamp();
      const pinnedMessage = await dmChannel.send({
        content: `Channel Info`,
        embeds: [dmChannelEmbed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("delete_dm_channel")
              .setLabel("Delete Channel")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });
      // pin the message
      await pinnedMessage.pin().catch(() => {
        console.error("Failed to pin the DM channel message.");
      });
    }

    // send the message to the dm channel
    const webhooks = await dmChannel.fetchWebhooks();
    let webhook = webhooks.find((wh) => wh.name === "dm hook");

    // create webhook if it doesn't exist
    if (!webhook) {
      webhook = await dmChannel.createWebhook({
        name: "dm hook",
        avatar: client.user.displayAvatarURL(),
        reason:
          "Sending ModMail messages properly!\nCreated automatically.\nDO NOT DELETE!!",
      });
    }

    await webhook.send({
      content: message.content || "-# [no content]",
      username: message.author.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL({ dynamic: true }),
      embeds: message.embeds,
      files: message.files,
    });

    /*
    const dmEmbed = new EmbedBuilder()
      .setColor(0x57f287) // green
      .setTitle(message.content || "[no content]")
      .setAuthor({
        name: `${message.author.displayName} (@${message.author.tag})`,
        iconURL: message.author.displayAvatarURL({ dynamic: true }),
      })
      .setFooter({ text: `DM sent from DMs` })
      .setTimestamp();
    let embeds = [dmEmbed];
    if (message.attachments.size > 0) {
      // add attachments to embeds
      embeds.push(
        ...message.attachments.map((att) => ({
          title: att.name,
          url: att.url,
        }))
      );
    }
    await dmChannel.send({
      embeds: embeds,
    });
    */
  } else if (message.channel.name.startsWith("dm-")) {
    // This is a DM channel, handle it
    const userId = message.channel.name.replace("dm-", "");
    const user = await client.users.fetch(userId).catch(() => null);
    // Send DM
    try {
      // make the dm into a fancy embed
      const dmEmbed = new EmbedBuilder()
        .setColor(0x57f287) // green
        .setTitle(message.content || "[no content]")
        .setAuthor({
          name: `${message.author.displayName} (@${message.author.tag})`,
          iconURL: message.author.displayAvatarURL({ dynamic: true }),
        })
        .setFooter({ text: `DM sent from Cat's Community` })
        .setTimestamp();
      let embeds = [dmEmbed];
      if (message.attachments.size > 0) {
        // add attachments to embeds
        embeds.push(
          ...message.attachments.map((att) => ({
            title: att.name,
            url: att.url,
          }))
        );
      }
      await user.send({ embeds: embeds });
    } catch (err) {
      console.error("Failed to send DM:", err);
      await message.channel.send({
        content: `Failed to send DM to <@${user.id}>. They may have DMs closed.`,
        allowedMentions: { users: [user.id] },
      });
    }
  }

  if (message.channel.id === COUNTING_CHANNEL_ID) {
    // Read current number, best streak, and last user ID from number.txt
    let { currentNum, bestNum, lastUserId } = countState;

    // Use improved math evaluation from countingService.js
    // Accept math expressions, word numbers, and handle rounding
    let expr = message.content.split("\n")[0].trim();

    // Try to convert word numbers to digits (simple mapping)
    // You can expand this mapping for more complex phrases
    const wordMap = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
      sixty: 60,
      seventy: 70,
      eighty: 80,
      ninety: 90,
    };
    let numericExpr = expr;
    if (wordMap[expr.toLowerCase()]) {
      numericExpr = wordMap[expr.toLowerCase()];
    } else if (
      /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)$/.test(
        expr.toLowerCase()
      )
    ) {
      // Handle phrases like "twenty five"
      const parts = expr.toLowerCase().split(" ");
      numericExpr = (wordMap[parts[0]] || 0) + (wordMap[parts[1]] || 0);
    }

    // Use mathEval-like logic
    let mathNum;
    let isMath = true;
    let mathNumOld;
    let errorMessage;
    try {
      // Try to evaluate as math expression
      mathNumOld = mathjs.evaluate(numericExpr);
      if (typeof mathNumOld === "number" && !isNaN(mathNumOld)) {
        mathNumOld = { result: mathNumOld, error: null, newMath: true };
      } else {
        // show up as typing
        await message.channel.sendTyping();
        mathNumOld = await mathEval(numericExpr);
      }
      // console.log(mathNumOld);
      if (mathNumOld.result !== null) {
        mathNum = Math.round(mathNumOld.result);
        isMath =
          typeof mathNumOld.result === "number" && !isNaN(mathNumOld.result);
      } else {
        isMath = false;
      }
      errorMessage = mathNumOld.error || null;
    } catch (err) {
      console.error(
        "Error evaluating math expression:",
        numericExpr,
        err.message
      );
      // mathNum.error = err.message;
      // isMath = false;
      // try other math before giving up
      await message.channel.sendTyping();
      mathNumOld = await mathEval(numericExpr);
      // console.log(mathNumOld);
      if (mathNumOld.result !== null) {
        mathNum = Math.round(mathNumOld.result);
        isMath =
          typeof mathNumOld.result === "number" && !isNaN(mathNumOld.result);
      } else {
        isMath = false;
      }
      errorMessage = mathNumOld.error || null;
    }

    if (isMath) {
      // Prevent same user twice in a row
      if (message.author.id === lastUserId) {
        await message.react("<:cat_dotdot:1393456922820349953>");
        await message.delete();
        const errorMsg = await message.channel.send({
          content: `<@${message.author.id}> You can't count twice in a row! <:cat_no:1393457236071944232>`,
          allowedMentions: { users: [message.author.id] },
        });
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        return;
      }
      if (mathNum !== currentNum + 1) {
        try {
          await message.react("<:cat_no:1393457236071944232>");
        } catch (err) {
          console.log("hanna you are annoying");
        }
        const errorMsg = await message.channel.send({
          content: `<@${
            message.author.id
          }> Wrong number or math! <:cat_no:1393457236071944232>\nNext should be **${
            currentNum + 1
          }**.\nYour message evaluated to: **${mathNum}** ${
            mathNumOld !== mathNum ? `(rounded from ${mathNumOld})` : ""
          }\nBest streak: **${bestNum}**\nCounter reset to 0.`,
          allowedMentions: { users: [message.author.id] },
        });
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        const nextNum = await message.channel.send({
          content: `0\n-# Streak broken by <@${message.author.id}> at ${
            currentNum + 1
          }.`,
          allowedMentions: { users: [] },
        });
        countState.currentNum = 0;
        countState.lastUserId = "";
        countState.bestNum = bestNum;
      } else {
        try {
          await message.react("<:cat_yippee:1393457234779967508>");
        } catch (err) {
          console.log("hanna you are annoying");
        }
        // stop typing by sending invisible message and deleting it
        if (!mathNumOld.newMath) {
          await message.channel
            .send({
              content: "Successfully calculated!",
            })
            .then((msg) => msg.delete().catch(() => {}));
        }
        const newBest = mathNum > bestNum ? mathNum : bestNum;
        countState.currentNum = mathNum;
        countState.bestNum = newBest;
        countState.lastUserId = message.author.id;
      }
    } else {
      const messageSent = await message.channel.send({
        content: `<@${
          message.author.id
        }> I couldn't evaluate that as a number! <:cat_dotdot:1393456922820349953>\nError: ${
          errorMessage || "Unknown error"
        }  `,
        allowedMentions: { users: [message.author.id] },
      });
      try {
        await message.react("<:cat_dotdot:1393456922820349953>"); // :cat_dotdot: custom emoji (in ccc)
      } catch (err) {
        console.warn("Something bad happened!" + err.message);
      }
      // remove reaction after 5s
      setTimeout(async () => {
        await messageSent.delete().catch(() => {});
        await message.delete().catch(() => {});
      }, 5000);
    }
    // If not math, do nothing (let chatting messages stay)
  }

  parseLevels(message);
});

client.on("messageDelete", async (message) => {
  if (message.bot) return;
  try {
    if (message.author.id === CLIENT_ID) return;
  } catch (err) {
    return;
  }

  if (message.channel.id === COUNTING_CHANNEL_ID) {
    // check if it was deleted by grasscat
    let isGrasscat;
    message.reactions.cache.forEach((i) => {
      if (i.emoji.id === "1393456922820349953") {
        isGrasscat = true;
      }
    });
    if (isGrasscat) {
      return;
    }

    // send message if not
    const newMsg = await message.channel.send(
      `${message.content.split("\n")[0].trim()}\n-# Deleted by <@${
        message.author.id
      }>`
    );
    await newMsg.react("<:cat_yippee:1393457234779967508>");
  }
});

// on reaction (starboard)
client.on("messageReactionAdd", handleStarUpdate);
client.on("messageReactionRemove", handleStarUpdate);

async function handleStarUpdate(reaction) {
  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message;
    const emoji = reaction.emoji.name;

    // Only handle ⭐ reactions
    if (emoji !== "⭐") return;

    const starCount = reaction.count || reaction.users.cache.size;
    const starboardChannel = await client.channels.fetch(STARBOARD_CHANNEL_ID);
    if (!starboardChannel?.isTextBased()) return;

    const existing = db
      .prepare("SELECT * FROM starboard WHERE message_id = ?")
      .get(message.id);

    // ⭐ REMOVE (under threshold)
    if (starCount < STARBOARD_MINIMUM) {
      if (existing) {
        try {
          const starMsg = await starboardChannel.messages.fetch(
            existing.starboard_message_id
          );
          await starMsg.delete();
        } catch (err) {
          console.warn("Failed to delete old starboard message:", err);
        }
        db.prepare("DELETE FROM starboard WHERE message_id = ?").run(
          message.id
        );
      }
      return;
    }

    // Build embed
    const embed = {
      color: 0xffd700,
      author: {
        name: message.author?.tag || "Unknown User",
        icon_url: message.author?.displayAvatarURL({ dynamic: true }),
      },
      description: message.content || "[no text]",
      fields: [
        {
          name: "Jump to Message",
          value: `[Click here](${message.url})`,
        },
      ],
      footer: {
        text: `⭐ ${starCount} | #${message.channel.name}`,
      },
      timestamp: message.createdAt,
    };

    const attachment = message.attachments.find((a) =>
      a.contentType?.startsWith("image/")
    );
    if (attachment) {
      embed.image = { url: attachment.url };
    }

    // ⭐ CREATE or UPDATE
    if (!existing) {
      const sent = await starboardChannel.send({ embeds: [embed] });
      db.prepare(
        `
        INSERT INTO starboard (message_id, starboard_message_id, starred_at)
        VALUES (?, ?, ?)
      `
      ).run(message.id, sent.id, new Date().toISOString());
    } else {
      // Update existing message
      try {
        const starMsg = await starboardChannel.messages.fetch(
          existing.starboard_message_id
        );
        await starMsg.edit({ embeds: [embed] });
      } catch (err) {
        console.warn("Failed to edit old starboard message:", err);
      }
    }
  } catch (err) {
    console.error("Error in starboard handler:", err);
  }
}

// join/leave messages
client.on("guildMemberAdd", async (member) => {
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287) // green
      .setTitle(`welcome, ${member.displayName}!`)
      .setDescription(`hey twin :3\n<@${member.id}>`)
      .setTimestamp()
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    const sentMessage = await channel.send({
      content: "<@&1388510033548939348>",
      embeds: [embed],
    });
    sentMessage.react("<:kitty_wave:1388509584246706176>");
  }
  // Send DM to the new member
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    const memberCount = members.filter((member) => !member.user.bot).size;
    await member.send({
      content: `# welcome to cat's community! :3\n- you can now go through the onboarding setup and get access to the server.\n- i'm <@${client.user.id}>, your new (not so evil) robot overlord.\n- you are joining ${memberCount} other users.\n## have a nice stay!\n\n-# if you need help, you can always mention me to see a help message.`,
    });
  } catch (err) {
    console.error(`Could not send DM to ${member.displayName}:`, err);
  }
});

client.on("guildMemberRemove", async (member) => {
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xed4245) // red
      .setTitle(`byebye ${member.displayName}.`)
      .setDescription(`aww no more friend :(\n<@${member.id}>`)
      .setTimestamp()
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    const sentMessage = await channel.send({
      content: "<@&1388510033548939348>",
      embeds: [embed],
    });
    sentMessage.react("<:kitty_cri:1388509582627966987>");
  }
});

// run code when boosted
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (oldMember.premiumSince === null && newMember.premiumSince !== null) {
    const channel = newMember.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287) // green
        .setTitle(`HOLY COW TYSM ${newMember.displayName}!`)
        .setDescription(
          `you are now a super duper special member of the server! :3\n<@${newMember.id}>`
        )
        .setTimestamp()
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }));
      const sentMessage = await channel.send({
        content: `the server has **${newMember.guild.premiumSubscriptionCount}** boosts!`,
        embeds: [embed],
      });
      sentMessage.react("<:cat_yippee:1393457234779967508>");
      // give the user the donator role
      const donatorRole = newMember.guild.roles.cache.find(
        (role) => role.id === "1392639801462886703" // replace with your donator role ID
      );
      if (donatorRole) {
        try {
          await newMember.roles.add(donatorRole);
          console.log(
            `Added donator role to ${newMember.displayName} (${newMember.id})`
          );
        } catch (err) {
          console.error(
            `Failed to add donator role to ${newMember.displayName}:`,
            err
          );
        }
      } else {
        console.error("Donator role not found!");
      }
    }
  }
});

// buttons
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "delete_dm_channel") {
    // Delete the channel
    const channel = interaction.channel;
    try {
      await channel.delete();
    } catch (err) {
      console.error("Failed to delete channel:", err);
      await interaction.reply({
        content: `Failed to delete channel ${channel.name}.`,
        ephemeral: true,
      });
    }
  }
});

async function parseLevels(message) {
  if (!message.guild) return;

  // no cheating in threads (this is talking to you eva (secret mwah)
  if (
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread ||
    message.channel.type === ChannelType.AnnouncementThread
  )
    return;

  const userId = message.author.id;
  const guildId = message.guild.id;

  // Give random XP between 10–15
  const xpToAdd = Math.floor(Math.random() * 6) + 10;

  const row = db
    .prepare(
      `
    SELECT * FROM levels WHERE user_id = ? AND guild_id = ?
  `
    )
    .get(userId, guildId);

  let newXp = xpToAdd;
  let level = 1;

  if (row) {
    newXp += row.xp;
    level = row.level;

    const nextLevelXp = level * 100;

    if (newXp >= nextLevelXp) {
      level += 1;
      newXp -= nextLevelXp;

      const levelUpEmbed = new EmbedBuilder()
        .setColor(0x00b7ff)
        .setTitle("🎉 You leveled up!")
        .setDescription(
          `Level ${level - 1} → Level ${level}\nYou now need ${
            level * 100 - newXp
          } more XP for level ${level + 1}!`
        )
        .setTimestamp()
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));

      // You could send a level-up message here
      message.channel.send({
        content: `<@${userId}>`,
        allowedMentions: { users: [userId] },
        embeds: [levelUpEmbed],
      });
    }

    db.prepare(
      `
      UPDATE levels SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?
    `
    ).run(newXp, level, userId, guildId);
  } else {
    db.prepare(
      `
      INSERT INTO levels (user_id, guild_id, xp, level)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, guildId, newXp, level);
  }
}

setInterval(() => {
  try {
    fs.writeFileSync(
      NUMBER_FILE,
      `${countState.currentNum}\n${countState.bestNum}\n${countState.lastUserId}`,
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save counting state:", err);
  }
}, 10_000); // Save every 10 seconds

client.login(TOKEN);
