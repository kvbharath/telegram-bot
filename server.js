import { Telegraf } from "telegraf";
import OpenAI from "openai";
import { message } from "telegraf/filters";
import dotenv from "dotenv";
import userModel from "./src/models/user.js";
import eventModel from "./src/models/event.js";
import connectDB from "./src/config/db.js";

// Load environment variables
dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);

const openai = new OpenAI({
  apiKey: process.env["OPENAI_KEY"],
});

try {
  connectDB();
  console.log("Database connected Successfully");
} catch (error) {
  console.log("error", error);
  process.kill(process.pid, "SIGTERM");
}

bot.start(async (ctx) => {
  const from = ctx.update.message.from;

  console.log("from", from);

  try {
    await userModel.findOneAndUpdate(
      { tgId: from.id },
      {
        $setOnInsert: {
          firstname: from.first_name,
          lastname: from.last_name,
          isBot: from.is_bot,
          username: from.username,
        },
      },
      { upsert: true, new: true }
    );
    //Store the user info into db
    await ctx.reply(
      `Hey! ${from.first_name},welcome. I will be writing highly engaging social media posts just keep feeding me with the events throught the day. let's shine on social media..`
    );
  } catch (error) {
    console.log("error", error);
    await ctx.reply("Facing difficulties!");
  }
});
bot.command("generate", async (ctx) => {
  const from = ctx.update.message.from;

  const { message_id: waitingMessageId } = await ctx.reply(
    `hey ${from.first_name},kindly wait for a moment. Iam curating posts for you.`
  );

  const { message_id: loadingStickerMsgId } = await ctx.replyWithSticker();
  console.log("messageId", waitingMessageId);

  const startOfTheDay = new Date();
  startOfTheDay.setHours(0, 0, 0, 0);

  const endOfTheDay = new Date();
  endOfTheDay.setHours(23, 59, 59, 999);

  // get events for the user..
  const events = await eventModel.find({
    tgId: from.id,
    createdAt: {
      $gte: startOfTheDay,
      $lte: endOfTheDay,
    },
  });

  if (events.length === 0) {
    await ctx.deleteMessage(waitingMessageId);
    await ctx.deleteMessage(loadingStickerMsgId);
    await ctx.reply(
      "No events found for today, please write some events in the chat."
    );

    return;
  }

  // make openai api call

  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Act as a senior copywriter, you write highly engaging posts for linkedin,facebook and twitter using provided thoughts/events throught the day",
        },
        {
          role: "user",
          content: `Write like a human, for humans. Craft three engaging social media posts tailored for LinkedIn, Facebook, and Twitter audiences. Use simple language
understand the order of the event, don't mention the time in the posts. Each post should creatively highlight the following events. Ensure the
impactful. Focus on engaging the respective platform's audience, encouraging interaction, and driving interest in the events:
    ${events.map((event) => event.text).join(", ")}`,
        },
      ],
      model: process.env.OPENAI_MODEL,
    });

    //store token count

    await userModel.findOneAndUpdate(
      {
        tgId: from.id,
      },
      {
        $inc: {
          promptTokens: chatCompletion.usage.prompt_tokens,
          completionTokens: chatCompletion.usage.completion_tokens,
        },
      }
    );
    await ctx.deleteMessage(waitingMessageId);
    await ctx.deleteMessage(loadingStickerMsgId);
    await ctx.reply(chatCompletion.choices[0].message.content);
  } catch (error) {
    console.log(error);
    await ctx.reply("Facing dificulties..");
  }
});

bot.help((ctx) => {
  ctx.reply("For support contact @bharath");
});

// bot.on(message("sticker"), (ctx) => {
//   console.log(ctc.update.message);
// });

bot.on(message("text"), async (ctx) => {
  const from = ctx.update.message.from;
  const message = ctx.update.message.text;

  try {
    await eventModel.create({
      text: message,
      tgId: from.id,
    });
    await ctx.reply(
      "Noted, Keep texting me your thoughts.To generate the posts,just enter the command: /generate"
    );
  } catch (error) {
    console.log("error", error);
    await ctx.reply("Facing difficulties!,Please try again later");
  }
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
