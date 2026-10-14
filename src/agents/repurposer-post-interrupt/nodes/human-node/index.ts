import {
  RepurposerPostInterruptState,
  RepurposerPostInterruptUpdate,
} from "../../types.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
import { END, interrupt } from "@langchain/langgraph";
import {
  formatScheduleDate,
  parseDateResponse,
  PRIORITY_LEVELS,
} from "../../../../utils/date.js";
import { scheduleTimezone } from "../../../../profiles/index.js";
import {
  constructDescription,
  getUnknownResponseDescription,
} from "./utils.js";
import { routeResponse } from "./router.js";
import { processImageInput } from "../../../utils.js";
import { DateType, Image } from "../../../types.js";

export async function humanNode(
  state: RepurposerPostInterruptState,
): Promise<RepurposerPostInterruptUpdate> {
  if (!state.post) {
    throw new Error("No post found");
  }

  let defaultDateString = "p1";
  if (
    typeof state.scheduleDate === "string" &&
    PRIORITY_LEVELS.includes(state.scheduleDate)
  ) {
    defaultDateString = state.scheduleDate as string;
  } else if (state.scheduleDate && typeof state.scheduleDate === "object") {
    defaultDateString = formatScheduleDate(
      state.scheduleDate as Date,
      scheduleTimezone(),
    );
  }

  const interruptValue: HumanInterrupt = {
    action_request: {
      action: "Schedule Repurposed Post",
      args: {
        date: defaultDateString,
        post: state.post,
        image: state.image?.imageUrl ?? "",
      },
    },
    config: {
      allow_accept: true,
      allow_edit: true,
      allow_ignore: true,
      allow_respond: true,
    },
    description: constructDescription({
      state,
      unknownResponseDescription: getUnknownResponseDescription(state),
    }),
  };

  const response = interrupt<HumanInterrupt[], HumanResponse[]>([
    interruptValue,
  ])[0];

  if (!["edit", "ignore", "accept", "response"].includes(response.type)) {
    throw new Error(
      `Unexpected response type: ${response.type}. Must be "edit", "ignore", "accept", or "response".`,
    );
  }
  if (response.type === "ignore") {
    return {
      next: END,
    };
  }
  if (!response.args) {
    throw new Error(
      `Unexpected response args: ${response.args}. Must be defined.`,
    );
  }

  if (response.type === "response") {
    if (typeof response.args !== "string") {
      throw new Error("Response args must be a string.");
    }

    const { route } = await routeResponse(state.post, response.args);

    if (route === "rewrite_post") {
      return {
        userResponse: response.args,
        next: "rewritePost",
      };
    }

    return {
      userResponse: response.args,
      next: "unknownResponse",
    };
  }

  if (typeof response.args !== "object") {
    throw new Error(
      `Unexpected response args type: ${typeof response.args}. Must be an object.`,
    );
  }
  if (!("args" in response.args)) {
    throw new Error(
      `Unexpected response args value: ${response.args}. Must be defined.`,
    );
  }

  const castArgs = response.args.args as unknown as Record<string, string>;
  const post = castArgs.post;
  if (!post) {
    throw new Error("No post found");
  }

  let imageState: Image | undefined = undefined;
  const processedImage = await processImageInput(castArgs.image);
  if (processedImage && processedImage !== "remove") {
    imageState = processedImage;
  } else if (processedImage === "remove") {
    imageState = undefined;
  } else {
    imageState = state.image;
  }

  const postDateString = castArgs.date;
  let postDate: DateType | undefined;
  if (postDateString) {
    postDate = parseDateResponse(postDateString);
    if (!postDate) {
      throw new Error(
        "Invalid date provided.\n\n" +
          "Expected format: 'MM/dd/yyyy hh:mm a z' or 'P1'/'P2'/'P3'/'R1'/'R2'/'R3' or leave empty to post now.\n\n" +
          `Received: '${postDateString}'`,
      );
    }
  }

  return {
    next: "schedulePost",
    scheduleDate: postDate,
    post,
    image: imageState,
    userResponse: undefined,
  };
}
